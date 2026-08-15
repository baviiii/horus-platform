/**
 * Career pathways and skill gaps.
 *
 * `pathway` answers "how do I get from here to there" by finding the shortest
 * chain of edges between two entities. `skillGap` answers "what am I missing"
 * by differencing what a target occupation requires against what someone says
 * they already have.
 *
 * Both are deliberately conservative: they only report chains the graph
 * actually contains. Where no path exists, that is the answer — inventing a
 * plausible-sounding route is worse than admitting the corpus is silent.
 */
import type { PrismaClient } from '@horus/db';
import { resolveEntity, findVariants } from './resolve.js';

export interface PathStep {
  from: string;
  fromType: string;
  relation: string;
  to: string;
  toType: string;
  evidence?: string;
}

export interface PathwayResult {
  from: { name: string; type: string };
  to: { name: string; type: string };
  /** Shortest chain found, in order. Empty when the graph has no route. */
  steps: PathStep[];
  found: boolean;
  hops: number;
  /** Set when resolution or traversal needs a caveat shown to the user. */
  note?: string;
}

export interface SkillGapResult {
  target: { name: string; type: string };
  /** Required by the target and already held. */
  have: string[];
  /** Required by the target and missing — the actual gap. */
  missing: Array<{ name: string; evidence?: string }>;
  /** Qualifications the corpus says lead to this occupation. */
  qualifications: Array<{ name: string; evidence?: string }>;
  coverage: 'strong' | 'partial' | 'thin';
}

const evidenceOf = (metadata: unknown): string | undefined =>
  (metadata as { evidence?: string[] } | null)?.evidence?.[0];

const MAX_HOPS = 4;
const FRONTIER_CAP = 400;

/**
 * Bidirectional-ish BFS over the relationship table.
 *
 * Edges are walked in both directions because a career route is not
 * directional in the graph's terms: `qualification --leads_to--> occupation`
 * and `sector --employs--> occupation` both describe steps a person takes,
 * pointing opposite ways. Depth and frontier are capped so a hub entity like
 * "South Australia" cannot blow up the query.
 */
export async function pathway(
  db: PrismaClient,
  fromName: string,
  toName: string,
): Promise<PathwayResult | null> {
  const from = await resolveEntity(db, fromName);
  const to = await resolveEntity(db, toName);
  if (!from || !to) return null;

  const base = {
    from: { name: from.name, type: from.type },
    to: { name: to.name, type: to.type },
  };

  if (from.id === to.id) {
    return {
      ...base,
      steps: [],
      found: true,
      hops: 0,
      note: 'Start and target are the same node.',
    };
  }

  // parent[nodeId] = the step that reached it, for reconstructing the chain.
  const parent = new Map<string, PathStep & { prevId: string }>();
  const visited = new Set<string>([from.id]);
  let frontier = [from.id];

  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const edges = await db.relationship.findMany({
      where: { OR: [{ fromEntityId: { in: frontier } }, { toEntityId: { in: frontier } }] },
      include: {
        fromEntity: { select: { id: true, name: true, type: true } },
        toEntity: { select: { id: true, name: true, type: true } },
      },
      orderBy: { confidence: 'desc' },
      take: FRONTIER_CAP,
    });

    const next: string[] = [];
    for (const edge of edges) {
      // Walk whichever end we haven't seen yet.
      const forward = visited.has(edge.fromEntityId);
      const nearId = forward ? edge.fromEntityId : edge.toEntityId;
      const farNode = forward ? edge.toEntity : edge.fromEntity;
      if (!visited.has(nearId) || visited.has(farNode.id)) continue;

      visited.add(farNode.id);
      next.push(farNode.id);
      const nearNode = forward ? edge.fromEntity : edge.toEntity;
      parent.set(farNode.id, {
        prevId: nearId,
        from: nearNode.name,
        fromType: nearNode.type,
        relation: edge.type,
        to: farNode.name,
        toType: farNode.type,
        evidence: evidenceOf(edge.metadata),
      });

      if (farNode.id === to.id) {
        // Walk parents back to the start, then reverse into reading order.
        const steps: PathStep[] = [];
        let cursor: string | undefined = to.id;
        while (cursor && cursor !== from.id) {
          const step = parent.get(cursor);
          if (!step) break;
          steps.unshift({
            from: step.from,
            fromType: step.fromType,
            relation: step.relation,
            to: step.to,
            toType: step.toType,
            evidence: step.evidence,
          });
          cursor = step.prevId;
        }
        return {
          ...base,
          steps,
          found: true,
          hops: steps.length,
          ...(from.matchedBy !== 'exact' || to.matchedBy !== 'exact'
            ? {
                note: `Matched loosely (${from.matchedBy}/${to.matchedBy}) — verify these are the intended entities.`,
              }
            : {}),
        };
      }
    }
    frontier = next;
  }

  return {
    ...base,
    steps: [],
    found: false,
    hops: 0,
    note: `No route within ${MAX_HOPS} hops. The corpus does not connect these — it is not evidence they are unrelated in reality.`,
  };
}

export async function skillGap(
  db: PrismaClient,
  targetName: string,
  haveSkills: string[],
): Promise<SkillGapResult | null> {
  const target = await resolveEntity(db, targetName, ['occupation']);
  if (!target) return null;
  const variants = await findVariants(db, target);
  const ids = [target.id, ...variants.map((v) => v.id)];

  const [requiredRows, qualRows] = await Promise.all([
    db.relationship.findMany({
      where: { fromEntityId: { in: ids }, type: 'requires', toEntity: { type: 'skill' } },
      include: { toEntity: { select: { name: true } } },
      orderBy: { confidence: 'desc' },
      take: 40,
    }),
    db.relationship.findMany({
      where: { toEntityId: { in: ids }, type: 'leads_to', fromEntity: { type: 'qualification' } },
      include: { fromEntity: { select: { name: true } } },
      orderBy: { confidence: 'desc' },
      take: 20,
    }),
  ]);

  // Normalise both sides so "data analysis" matches "Data Analysis".
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const held = new Set(haveSkills.map(norm));

  const seen = new Set<string>();
  const have: string[] = [];
  const missing: Array<{ name: string; evidence?: string }> = [];

  for (const row of requiredRows) {
    const key = norm(row.toEntity.name);
    if (seen.has(key)) continue;
    seen.add(key);
    // Substring either way: "welding" satisfies "welding techniques".
    const matched = [...held].some((h) => h === key || key.includes(h) || h.includes(key));
    if (matched) have.push(row.toEntity.name);
    else missing.push({ name: row.toEntity.name, evidence: evidenceOf(row.metadata) });
  }

  const qualifications = qualRows.map((r) => ({
    name: r.fromEntity.name,
    evidence: evidenceOf(r.metadata),
  }));

  const total = have.length + missing.length;
  return {
    target: { name: target.name, type: target.type },
    have,
    missing,
    qualifications,
    coverage: total >= 6 ? 'strong' : total >= 2 ? 'partial' : 'thin',
  };
}
