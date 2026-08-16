import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { moderateText, moderateTexts } from '@horus/core/safety';
import {
  absorbTemplate,
  computeDeadlines,
  draftIncidentFields,
  FieldValueSchema,
  NDIS_PACK,
  normalizeTemplateSchema,
  requiredMissing,
  STARTER_NDIS_TEMPLATE,
  STARTER_TEMPLATE_DESCRIPTION,
  STARTER_TEMPLATE_NAME,
  type IncidentFields,
  type TemplateSchema,
} from '@horus/core/incidents';
import { router, scopedProcedure } from '../trpc.js';
import { audit } from '../audit.js';
import type { Context } from '../context.js';

/**
 * Incident reporting (NDIS vertical).
 *
 * Lifecycle: template absorbed from the provider's own form → incident
 * created from evidence → AI drafts fields with per-field citations → human
 * reviews/edits → submit → approve (ADMIN/OWNER, missing-required must be
 * empty) → export .docx (identified / de-identified) → close.
 *
 * Design constraints that are product promises, not implementation details:
 *  - the model only fills fields it can cite; gaps go to missingRequired
 *  - approval requires a signed-in human — an API key can never approve
 *  - nothing here submits to a regulator; export is the terminal act
 *  - every state change lands in IncidentEvent (timeline) + AuditLog
 */

const StatusEnum = z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'EXPORTED', 'CLOSED']);
const SeverityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

type Db = NonNullable<Context['db']>;

/** Human ref like INC-2026-0042, unique per tenant; retries on collision. */
async function nextIncidentRef(db: Db, tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INC-${year}-`;
  const count = await db.incident.count({
    where: { tenantId, ref: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

function actorId(ctx: { user: { id: string } | null; apiKey: { createdById: string } | null }) {
  const id = ctx.user?.id ?? ctx.apiKey?.createdById;
  if (!id) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No acting identity in context' });
  }
  return id;
}

function forbidViewer(ctx: { user: { role: string } | null }) {
  if (ctx.user && ctx.user.role === 'VIEWER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot modify incidents' });
  }
}

async function addEvent(
  db: Db,
  params: {
    tenantId: string;
    incidentId: string;
    kind: string;
    actorId?: string;
    note?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.incidentEvent.create({
    data: {
      tenantId: params.tenantId,
      incidentId: params.incidentId,
      kind: params.kind,
      actorId: params.actorId,
      note: params.note,
      meta: (params.meta ?? {}) as object,
    },
  });
}

/** Recompute the statutory clocks from category + awareness moment. */
function deadlinePatch(
  categoryKey: string | null,
  discoveredAt: Date | null,
  occurredAt: Date | null,
  createdAt: Date,
) {
  const awareAt = discoveredAt ?? occurredAt ?? createdAt;
  const deadlines = computeDeadlines(categoryKey, awareAt);
  return { notifyDueAt: deadlines.notifyDueAt, reportDueAt: deadlines.reportDueAt };
}

export const incidentsRouter = router({
  /** The active regulatory pack (categories, timeframes, disclaimer). */
  reference: scopedProcedure('incidents:read').query(() => NDIS_PACK),

  /* ── Templates ─────────────────────────────────────────────────────── */

  listTemplates: scopedProcedure('incidents:read')
    .input(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      return ctx.db.incidentTemplate.findMany({
        where: { ...(input.status && { status: input.status }) },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        include: { _count: { select: { incidents: true } } },
      });
    }),

  getTemplate: scopedProcedure('incidents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.db.incidentTemplate.findUnique({ where: { id: input.id } });
      if (!template) throw new TRPCError({ code: 'NOT_FOUND' });
      return template;
    }),

  /** Absorb an uploaded form (already text-extracted) into a typed template. */
  absorbTemplate: scopedProcedure('incidents:write')
    .input(
      z.object({
        filename: z.string().min(1).max(200),
        text: z.string().min(80, 'Form text is too short to absorb').max(120_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const verdict = await moderateTexts([input.text]);
      if (verdict.blocked) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Form was blocked by the content policy (${verdict.category}).`,
        });
      }

      const absorbed = await absorbTemplate({ sourceText: input.text, filename: input.filename });

      const template = await ctx.db.incidentTemplate.create({
        data: {
          tenantId: ctx.tenant.id,
          name: absorbed.name,
          description: absorbed.description,
          status: 'DRAFT',
          schema: absorbed.schema as object,
          sourceDocumentTitle: input.filename,
          sourceExcerpt: input.text.slice(0, 600),
          createdById: actorId(ctx),
        },
      });

      await audit(ctx.db, ctx, 'incidents.template.absorb', {
        resource: 'incident_template',
        resourceId: template.id,
        metadata: {
          filename: input.filename,
          fields: absorbed.schema.fields.length,
          model: absorbed.model,
        },
      });
      return template;
    }),

  /** One-click NDIS starter template — active immediately, edit freely. */
  createStarterTemplate: scopedProcedure('incidents:write').mutation(async ({ ctx }) => {
    forbidViewer(ctx);
    const existing = await ctx.db.incidentTemplate.findFirst({
      where: { name: STARTER_TEMPLATE_NAME },
    });
    if (existing) return existing;

    const template = await ctx.db.incidentTemplate.create({
      data: {
        tenantId: ctx.tenant.id,
        name: STARTER_TEMPLATE_NAME,
        description: STARTER_TEMPLATE_DESCRIPTION,
        status: 'ACTIVE',
        schema: STARTER_NDIS_TEMPLATE as object,
        createdById: actorId(ctx),
      },
    });
    await audit(ctx.db, ctx, 'incidents.template.starter', {
      resource: 'incident_template',
      resourceId: template.id,
    });
    return template;
  }),

  updateTemplate: scopedProcedure('incidents:write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(300).optional(),
        /** Full TemplateSchema JSON; validated + normalized before write. */
        schema: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const existing = await ctx.db.incidentTemplate.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      let schema: TemplateSchema | undefined;
      if (input.schema !== undefined) {
        try {
          schema = normalizeTemplateSchema(input.schema);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Template schema invalid: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}`,
          });
        }
      }

      const template = await ctx.db.incidentTemplate.update({
        where: { id: input.id },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(schema && { schema: schema as object, version: existing.version + 1 }),
        },
      });

      await audit(ctx.db, ctx, 'incidents.template.update', {
        resource: 'incident_template',
        resourceId: template.id,
        metadata: { schemaChanged: schema !== undefined, version: template.version },
      });
      return template;
    }),

  setTemplateStatus: scopedProcedure('incidents:write')
    .input(z.object({ id: z.string().uuid(), status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']) }))
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const template = await ctx.db.incidentTemplate.update({
        where: { id: input.id },
        data: { status: input.status },
      });
      await audit(ctx.db, ctx, 'incidents.template.status', {
        resource: 'incident_template',
        resourceId: template.id,
        metadata: { status: input.status },
      });
      return template;
    }),

  /* ── Incidents ─────────────────────────────────────────────────────── */

  /** Create a DRAFT incident + its narrative evidence. No model call here. */
  create: scopedProcedure('incidents:write')
    .input(
      z.object({
        templateId: z.string().uuid(),
        narrative: z.string().min(40, 'Describe what happened first').max(24_000),
        occurredAt: z.date().optional(),
        discoveredAt: z.date().optional(),
        categoryKey: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const template = await ctx.db.incidentTemplate.findUnique({
        where: { id: input.templateId },
      });
      if (!template || template.status === 'ARCHIVED') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found or archived' });
      }

      const verdict = await moderateText(input.narrative);
      if (verdict.blocked) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Narrative was blocked by the content policy (${verdict.category}).`,
        });
      }

      const reporter = actorId(ctx);
      const now = new Date();

      // Ref collisions are possible under concurrency — retry with a fresh count.
      let incident = null;
      for (let attempt = 0; attempt < 3 && !incident; attempt++) {
        const ref = await nextIncidentRef(ctx.db, ctx.tenant.id);
        try {
          incident = await ctx.db.incident.create({
            data: {
              tenantId: ctx.tenant.id,
              ref,
              templateId: template.id,
              title: 'Untitled incident',
              categoryKey: input.categoryKey ?? null,
              occurredAt: input.occurredAt,
              discoveredAt: input.discoveredAt,
              reportedById: reporter,
              ...deadlinePatch(
                input.categoryKey ?? null,
                input.discoveredAt ?? null,
                input.occurredAt ?? null,
                now,
              ),
            },
          });
        } catch (err) {
          const unique = (err as { code?: string }).code === 'P2002';
          if (!unique || attempt === 2) throw err;
        }
      }
      if (!incident) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await ctx.db.incidentEvidence.create({
        data: {
          tenantId: ctx.tenant.id,
          incidentId: incident.id,
          kind: 'NARRATIVE',
          label: 'Reporter narrative',
          text: input.narrative,
          addedById: reporter,
        },
      });
      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'created',
        actorId: reporter,
      });
      await audit(ctx.db, ctx, 'incidents.create', {
        resource: 'incident',
        resourceId: incident.id,
        metadata: { ref: incident.ref, templateId: template.id },
      });
      return incident;
    }),

  /**
   * Run the AI draft over the incident's evidence. Fills empty fields with
   * cited values; never touches values a human marked by editing them.
   */
  draft: scopedProcedure('incidents:write')
    .input(z.object({ incidentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.incidentId },
        include: { template: true, evidence: true },
      });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!incident.template) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Incident has no template' });
      }
      if (incident.status !== 'DRAFT' && incident.status !== 'IN_REVIEW') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only draft or in-review incidents can be re-drafted',
        });
      }

      const schema = normalizeTemplateSchema(incident.template.schema);
      const evidence = incident.evidence
        .filter((e) => e.text && e.text.trim().length > 0)
        .map((e) => ({ id: e.id, label: e.label, text: e.text! }));
      if (evidence.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No usable evidence to draft from' });
      }

      const manualFields = (incident.fields ?? {}) as IncidentFields;
      const result = await draftIncidentFields({ schema, evidence, manualFields });

      const categoryKey = incident.categoryKey ?? result.suggestedCategoryKey;
      const occurredAt =
        incident.occurredAt ?? (result.occurredAtIso ? new Date(result.occurredAtIso) : null);

      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: {
          fields: result.fields as object,
          missingRequired: result.missingRequired,
          categoryKey,
          occurredAt,
          severity: incident.severity === 'MEDIUM' ? result.suggestedSeverity : incident.severity,
          title: incident.title === 'Untitled incident' ? result.title : incident.title,
          summary: incident.summary ?? result.summary,
          ...deadlinePatch(
            categoryKey ?? null,
            incident.discoveredAt,
            occurredAt,
            incident.createdAt,
          ),
        },
      });

      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'drafted',
        actorId: ctx.user?.id,
        meta: {
          model: result.model,
          filled: Object.keys(result.fields).length,
          missing: result.missingRequired.length,
          usage: result.usage,
        },
      });
      await ctx.db.usageRecord.createMany({
        data: [
          {
            tenantId: ctx.tenant.id,
            apiKeyId: ctx.apiKey?.id,
            meter: 'COMPLETION_TOKENS_IN',
            quantity: BigInt(result.usage.inputTokens),
            metadata: { task: 'incidents.draft' },
          },
          {
            tenantId: ctx.tenant.id,
            apiKeyId: ctx.apiKey?.id,
            meter: 'COMPLETION_TOKENS_OUT',
            quantity: BigInt(result.usage.outputTokens),
            metadata: { task: 'incidents.draft' },
          },
        ],
      });
      await audit(ctx.db, ctx, 'incidents.draft', {
        resource: 'incident',
        resourceId: incident.id,
        metadata: { filled: Object.keys(result.fields).length },
      });
      return updated;
    }),

  /** Human edits: field values (marked manual), classification, meta. */
  update: scopedProcedure('incidents:write')
    .input(
      z.object({
        incidentId: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        categoryKey: z.string().max(64).nullable().optional(),
        severity: SeverityEnum.optional(),
        occurredAt: z.date().nullable().optional(),
        discoveredAt: z.date().nullable().optional(),
        location: z.string().max(300).nullable().optional(),
        summary: z.string().max(2000).nullable().optional(),
        /** fieldKey → new value; null clears. Values become confidence:"manual". */
        fields: z.record(z.string(), FieldValueSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.incidentId },
        include: { template: true },
      });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      if (incident.status === 'CLOSED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Closed incidents are immutable' });
      }

      const schema = incident.template ? normalizeTemplateSchema(incident.template.schema) : null;
      const fields = { ...((incident.fields ?? {}) as IncidentFields) };
      const changedKeys: string[] = [];

      if (input.fields && schema) {
        const known = new Set(schema.fields.map((f) => f.key));
        for (const [key, value] of Object.entries(input.fields)) {
          if (!known.has(key)) continue;
          changedKeys.push(key);
          if (value === null || (typeof value === 'string' && value.trim() === '')) {
            delete fields[key];
          } else {
            fields[key] = { value, confidence: 'manual', evidence: fields[key]?.evidence ?? [] };
          }
        }
      }

      const categoryKey =
        input.categoryKey !== undefined ? input.categoryKey : incident.categoryKey;
      const occurredAt = input.occurredAt !== undefined ? input.occurredAt : incident.occurredAt;
      const discoveredAt =
        input.discoveredAt !== undefined ? input.discoveredAt : incident.discoveredAt;

      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: {
          ...(input.title && { title: input.title }),
          ...(input.severity && { severity: input.severity }),
          ...(input.location !== undefined && { location: input.location }),
          ...(input.summary !== undefined && { summary: input.summary }),
          categoryKey,
          occurredAt,
          discoveredAt,
          fields: fields as object,
          missingRequired: schema ? requiredMissing(schema, fields) : incident.missingRequired,
          ...deadlinePatch(categoryKey, discoveredAt, occurredAt, incident.createdAt),
        },
      });

      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'field_updated',
        actorId: ctx.user?.id,
        meta: { keys: changedKeys.slice(0, 20) },
      });
      return updated;
    }),

  addNoteEvidence: scopedProcedure('incidents:write')
    .input(
      z.object({
        incidentId: z.string().uuid(),
        label: z.string().min(1).max(120),
        text: z.string().min(1).max(24_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const incident = await ctx.db.incident.findUnique({ where: { id: input.incidentId } });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });

      const verdict = await moderateText(input.text);
      if (verdict.blocked) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Note was blocked by the content policy (${verdict.category}).`,
        });
      }

      const evidence = await ctx.db.incidentEvidence.create({
        data: {
          tenantId: ctx.tenant.id,
          incidentId: incident.id,
          kind: 'NOTE',
          label: input.label,
          text: input.text,
          addedById: actorId(ctx),
        },
      });
      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'evidence_added',
        actorId: ctx.user?.id,
        meta: { kind: 'NOTE', label: input.label },
      });
      return evidence;
    }),

  submit: scopedProcedure('incidents:write')
    .input(z.object({ incidentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const incident = await ctx.db.incident.findUnique({ where: { id: input.incidentId } });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      if (incident.status !== 'DRAFT') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only drafts can be submitted' });
      }

      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: { status: 'IN_REVIEW' },
      });
      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'submitted',
        actorId: ctx.user?.id,
      });
      await audit(ctx.db, ctx, 'incidents.submit', {
        resource: 'incident',
        resourceId: incident.id,
      });
      return updated;
    }),

  /** Approval is a human act: signed-in ADMIN/OWNER, no gaps in required fields. */
  approve: scopedProcedure('incidents:write')
    .input(z.object({ incidentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user || (ctx.user.role !== 'ADMIN' && ctx.user.role !== 'OWNER')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Approval requires a signed-in workspace admin or owner',
        });
      }
      const incident = await ctx.db.incident.findUnique({ where: { id: input.incidentId } });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      if (incident.status !== 'IN_REVIEW') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only in-review incidents can be approved',
        });
      }
      if (incident.missingRequired.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot approve with ${incident.missingRequired.length} required field(s) missing`,
        });
      }

      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: { status: 'APPROVED', approvedById: ctx.user.id, approvedAt: new Date() },
      });
      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'approved',
        actorId: ctx.user.id,
        // Email captured here so exports can print who approved without a
        // Supabase lookup (user display data lives outside our schema).
        meta: { email: ctx.user.email },
      });
      await audit(ctx.db, ctx, 'incidents.approve', {
        resource: 'incident',
        resourceId: incident.id,
        metadata: { ref: incident.ref },
      });
      return updated;
    }),

  requestChanges: scopedProcedure('incidents:write')
    .input(z.object({ incidentId: z.string().uuid(), note: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user || (ctx.user.role !== 'ADMIN' && ctx.user.role !== 'OWNER')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Review requires an admin or owner' });
      }
      const incident = await ctx.db.incident.findUnique({ where: { id: input.incidentId } });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      if (incident.status !== 'IN_REVIEW') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Incident is not in review' });
      }

      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: { status: 'DRAFT' },
      });
      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'changes_requested',
        actorId: ctx.user.id,
        note: input.note,
      });
      await audit(ctx.db, ctx, 'incidents.request_changes', {
        resource: 'incident',
        resourceId: incident.id,
      });
      return updated;
    }),

  close: scopedProcedure('incidents:write')
    .input(z.object({ incidentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      forbidViewer(ctx);
      const incident = await ctx.db.incident.findUnique({ where: { id: input.incidentId } });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      if (incident.status !== 'APPROVED' && incident.status !== 'EXPORTED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only approved or exported incidents can be closed',
        });
      }

      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await addEvent(ctx.db, {
        tenantId: ctx.tenant.id,
        incidentId: incident.id,
        kind: 'closed',
        actorId: ctx.user?.id,
      });
      await audit(ctx.db, ctx, 'incidents.close', {
        resource: 'incident',
        resourceId: incident.id,
      });
      return updated;
    }),

  list: scopedProcedure('incidents:read')
    .input(
      z
        .object({
          status: StatusEnum.optional(),
          limit: z.number().int().min(1).max(100).default(25),
          cursor: z.string().uuid().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.incident.findMany({
        where: { ...(input.status && { status: input.status }) },
        take: input.limit + 1,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
        include: { template: { select: { name: true } } },
      });
      const nextCursor = items.length > input.limit ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  get: scopedProcedure('incidents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.id },
        include: {
          template: true,
          evidence: { orderBy: { createdAt: 'asc' } },
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND' });
      return incident;
    }),

  /** Dashboard numbers: status counts, statutory clocks, category mix. */
  stats: scopedProcedure('incidents:read').query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const activeStatuses = ['DRAFT', 'IN_REVIEW'] as const;

    const [byStatus, bySeverity, byCategory, thisMonth, overdue, upcoming, recent] =
      await Promise.all([
        ctx.db.incident.groupBy({ by: ['status'], _count: true }),
        ctx.db.incident.groupBy({ by: ['severity'], _count: true }),
        ctx.db.incident.groupBy({ by: ['categoryKey'], _count: true }),
        ctx.db.incident.count({ where: { createdAt: { gte: monthStart } } }),
        ctx.db.incident.count({
          where: { status: { in: [...activeStatuses] }, notifyDueAt: { lt: now } },
        }),
        ctx.db.incident.findMany({
          where: { status: { in: [...activeStatuses] }, notifyDueAt: { gte: now } },
          orderBy: { notifyDueAt: 'asc' },
          take: 5,
          select: {
            id: true,
            ref: true,
            title: true,
            status: true,
            severity: true,
            categoryKey: true,
            notifyDueAt: true,
            reportDueAt: true,
          },
        }),
        ctx.db.incident.findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { template: { select: { name: true } } },
        }),
      ]);

    return { byStatus, bySeverity, byCategory, thisMonth, overdue, upcoming, recent };
  }),
});
