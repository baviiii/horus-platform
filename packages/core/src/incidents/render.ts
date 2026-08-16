/**
 * .docx rendering — the deliverable a provider actually files.
 *
 * Markdown in a chat box is not an incident report. This produces a clean,
 * professional Word document from a template schema + field values: meta
 * block with statutory deadlines, the form's own sections and labels, an
 * evidence appendix, approval block, and an honest footer (mode, disclaimer,
 * "Horus never submits on your behalf"). Identified and de-identified
 * renditions share this renderer — de-ID transforms values upstream.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  formatFieldValue,
  isFieldVisible,
  type IncidentFields,
  type TemplateSchema,
} from './schema.js';

export type RenderMode = 'identified' | 'deidentified';

export interface RenderEvidenceItem {
  label: string;
  kind: string;
  text: string | null;
}

export interface RenderIncidentParams {
  org: string;
  templateName: string;
  mode: RenderMode;
  /** Big diagonal-feel banner text for demos; omit in production exports. */
  demo?: boolean;
  incident: {
    ref: string;
    title: string;
    status: string;
    severity: string;
    categoryLabel: string | null;
    occurredAt: Date | null;
    discoveredAt: Date | null;
    location: string | null;
    summary: string | null;
    notifyDueAt: Date | null;
    reportDueAt: Date | null;
    deadlineBasis: string | null;
    approvedByName: string | null;
    approvedAt: Date | null;
    createdAt: Date;
  };
  schema: TemplateSchema;
  fields: IncidentFields;
  evidence: RenderEvidenceItem[];
  /** Reference-pack disclaimer, shown verbatim in the footer. */
  disclaimer: string;
  /** Set when de-ID ran without the Language sweep (deterministic layers only). */
  deidDegraded?: boolean;
}

const INK = '1a1a1a';
const MUTE = '6b7280';
const HAIRLINE = 'd9dde3';

const fmtDateTime = (d: Date | null): string =>
  d
    ? d.toLocaleString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

function metaRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 32, type: WidthType.PERCENTAGE },
        borders: hairlineBorders(),
        children: [
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: [new TextRun({ text: label, size: 18, color: MUTE })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        borders: hairlineBorders(),
        children: [
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: [new TextRun({ text: value, size: 20, color: INK })],
          }),
        ],
      }),
    ],
  });
}

function hairlineBorders() {
  const side = { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } as const;
  return { top: side, bottom: side, left: side, right: side };
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, color: INK })],
  });
}

function bodyPara(text: string, opts?: { muted?: boolean; small?: boolean }): Paragraph {
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      new TextRun({
        text,
        size: opts?.small ? 16 : 20,
        color: opts?.muted ? MUTE : INK,
      }),
    ],
  });
}

export async function renderIncidentDocx(params: RenderIncidentParams): Promise<Buffer> {
  const { incident, schema, fields } = params;
  const children: Array<Paragraph | Table> = [];

  // ── Masthead ──
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: params.org, bold: true, size: 22, color: MUTE })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: `${params.templateName}`, bold: true, size: 36, color: INK })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: `${incident.ref} — ${incident.title}`, size: 22, color: MUTE }),
      ],
    }),
  );

  // ── Mode banners ──
  const banners: string[] = [];
  if (params.demo)
    banners.push('DEMO DOCUMENT — generated from sample data in the Horus playground');
  if (params.mode === 'deidentified') {
    banners.push(
      params.deidDegraded
        ? 'DE-IDENTIFIED COPY (deterministic layers only — PII sweep service unavailable; review before sharing)'
        : 'DE-IDENTIFIED COPY — names and identifiers replaced; review before sharing',
    );
  }
  if (incident.status === 'DRAFT' || incident.status === 'IN_REVIEW') {
    banners.push(`${incident.status.replace('_', ' ')} — NOT YET APPROVED`);
  }
  for (const banner of banners) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
        shading: { fill: 'f3f4f6' },
        children: [new TextRun({ text: banner, bold: true, size: 18, color: '9a3412' })],
      }),
    );
  }

  // ── Meta table ──
  const metaRows = [
    metaRow('Reference', incident.ref),
    metaRow('Status', incident.status.replace('_', ' ')),
    metaRow('Severity', incident.severity),
    metaRow('Reportable category', incident.categoryLabel ?? 'Not classified'),
    metaRow('Occurred', fmtDateTime(incident.occurredAt)),
    metaRow('Provider became aware', fmtDateTime(incident.discoveredAt)),
    ...(incident.location ? [metaRow('Location', incident.location)] : []),
    metaRow('Notification due', fmtDateTime(incident.notifyDueAt)),
    metaRow('Detailed report due', fmtDateTime(incident.reportDueAt)),
    metaRow('Generated', fmtDateTime(new Date())),
  ];
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: metaRows,
    }),
  );
  if (incident.deadlineBasis) {
    children.push(bodyPara(incident.deadlineBasis, { muted: true, small: true }));
  }

  // ── Summary ──
  if (incident.summary) {
    children.push(heading('Summary'), bodyPara(incident.summary));
  }

  // ── Sections ──
  for (const section of schema.sections) {
    const visible = schema.fields.filter(
      (f) => f.section === section.key && isFieldVisible(f, fields),
    );
    if (visible.length === 0) continue;

    children.push(heading(section.title));
    if (section.description) {
      children.push(bodyPara(section.description, { muted: true, small: true }));
    }

    const longText = visible.filter((f) => f.type === 'textarea');
    const shortFields = visible.filter((f) => f.type !== 'textarea');

    if (shortFields.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: shortFields.map((f) => metaRow(f.label, formatFieldValue(f, fields[f.key]?.value))),
        }),
      );
    }
    for (const f of longText) {
      children.push(
        new Paragraph({
          spacing: { before: 140, after: 40 },
          children: [new TextRun({ text: f.label, bold: true, size: 20, color: INK })],
        }),
      );
      const value = formatFieldValue(f, fields[f.key]?.value);
      for (const para of value.split(/\n+/)) {
        children.push(bodyPara(para));
      }
    }
  }

  // ── Evidence appendix ──
  if (params.evidence.length > 0) {
    children.push(heading('Evidence appendix'));
    params.evidence.forEach((item, i) => {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            new TextRun({
              text: `E${i + 1} — ${item.label} (${item.kind.toLowerCase()})`,
              bold: true,
              size: 20,
              color: INK,
            }),
          ],
        }),
      );
      if (item.text) {
        for (const para of item.text.slice(0, 1600).split(/\n+/)) {
          children.push(bodyPara(para, { small: true }));
        }
      }
    });
  }

  // ── Approval block ──
  children.push(heading('Approval'));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        metaRow(
          'Approved by',
          incident.approvedByName ?? 'Pending — this document is not yet approved',
        ),
        metaRow('Approved at', fmtDateTime(incident.approvedAt)),
      ],
    }),
  );

  // ── Footer ──
  children.push(
    new Paragraph({ spacing: { before: 360 }, children: [] }),
    bodyPara(
      'Prepared with Horus. This document is a drafting aid for provider review and record-keeping — ' +
        'Horus never lodges notifications or reports with the NDIS Commission on your behalf.',
      { muted: true, small: true },
    ),
    bodyPara(params.disclaimer, { muted: true, small: true }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20, color: INK } },
      },
    },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}
