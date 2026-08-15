/**
 * Regulatory reference packs — versioned, source-linked deadline rules.
 *
 * IMPORTANT: this file is reference DATA, not legal advice. The NDIS pack
 * was seeded from the NDIS (Incident Management and Reportable Incidents)
 * Rules 2018 (F2018L00633) as published on legislation.gov.au, retrieved
 * 2026-07-29. Rules change; re-verify before relying on a deadline, and keep
 * `version`/`retrievedAt` honest when updating. The UI must always show
 * `disclaimer` next to computed deadlines.
 */

export interface IncidentCategory {
  key: string;
  label: string;
  description: string;
  /** Notify the regulator within this many hours of key personnel becoming aware. */
  notifyWithinHours?: number;
  /** ...or within this many business days (whichever the category specifies). */
  notifyWithinBusinessDays?: number;
  /** A more detailed report is due this many business days after becoming aware. */
  detailedReportBusinessDays?: number;
  guidance?: string;
}

export interface RegulatoryPack {
  key: string;
  name: string;
  /** Bump when the encoded rules change. */
  version: string;
  retrievedAt: string; // ISO date the sources were last verified
  sources: Array<{ label: string; url: string }>;
  disclaimer: string;
  categories: IncidentCategory[];
}

export const NDIS_PACK: RegulatoryPack = {
  key: 'ndis',
  name: 'NDIS reportable incidents',
  version: '2026.07',
  retrievedAt: '2026-07-29',
  sources: [
    {
      label: 'NDIS (Incident Management and Reportable Incidents) Rules 2018',
      url: 'https://www.legislation.gov.au/F2018L00633/latest/text',
    },
    {
      label: 'NDIS Commission — reportable incidents guidance',
      url: 'https://www.ndiscommission.gov.au/reportable-incidents',
    },
  ],
  disclaimer:
    'Deadlines are computed from the NDIS Rules as encoded on 2026-07-29. Business-day maths ' +
    'excludes weekends only — public holidays are not yet modelled. Verify against current ' +
    'Commission guidance; this tool assists reporting and never submits on your behalf.',
  categories: [
    {
      key: 'death',
      label: 'Death of a person with disability',
      description: 'The death of a person with disability in connection with NDIS supports.',
      notifyWithinHours: 24,
      detailedReportBusinessDays: 5,
    },
    {
      key: 'serious_injury',
      label: 'Serious injury',
      description: 'Serious injury of a person with disability.',
      notifyWithinHours: 24,
      detailedReportBusinessDays: 5,
    },
    {
      key: 'abuse_neglect',
      label: 'Abuse or neglect',
      description: 'Abuse or neglect of a person with disability.',
      notifyWithinHours: 24,
      detailedReportBusinessDays: 5,
    },
    {
      key: 'unlawful_contact_or_assault',
      label: 'Unlawful sexual or physical contact / assault',
      description:
        'Unlawful sexual or physical contact with, or assault of, a person with disability. ' +
        'Physical contact with negligible contact and impact is excluded (Rules s16(2)).',
      notifyWithinHours: 24,
      detailedReportBusinessDays: 5,
    },
    {
      key: 'sexual_misconduct',
      label: 'Sexual misconduct',
      description:
        'Sexual misconduct committed against, or in the presence of, a person with disability, ' +
        'including grooming for sexual activity.',
      notifyWithinHours: 24,
      detailedReportBusinessDays: 5,
    },
    {
      key: 'unauthorised_restrictive_practice',
      label: 'Unauthorised use of a restrictive practice',
      description:
        'Use of a restrictive practice other than in accordance with a required authorisation ' +
        'or a behaviour support plan (Rules s16(3)).',
      notifyWithinBusinessDays: 5,
      guidance:
        'If the use also caused harm that meets another category (e.g. serious injury), the ' +
        '24-hour clock for that category applies instead.',
    },
  ],
};

/** Packs shipped with the platform, keyed by pack key. */
export const REGULATORY_PACKS: Record<string, RegulatoryPack> = {
  [NDIS_PACK.key]: NDIS_PACK,
};

export function categoryByKey(key: string | null | undefined): IncidentCategory | null {
  if (!key) return null;
  return NDIS_PACK.categories.find((c) => c.key === key) ?? null;
}

/* ── Deadline engine ──────────────────────────────────────────────────── */

/** Add n business days (Mon–Fri; public holidays intentionally not modelled). */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

export interface DeadlineInfo {
  /** When the initial notification is due (24h or 5 business days). */
  notifyDueAt: Date | null;
  /** When the more detailed report is due (business days). */
  reportDueAt: Date | null;
  /** Human-readable basis, e.g. "24 hours + 5 business days from awareness". */
  basis: string;
}

/**
 * Statutory clocks for a category, running from when key personnel became
 * aware of the incident (`awareAt`).
 */
export function computeDeadlines(
  categoryKey: string | null | undefined,
  awareAt: Date,
): DeadlineInfo {
  const category = categoryByKey(categoryKey);
  if (!category) {
    return { notifyDueAt: null, reportDueAt: null, basis: 'No reportable category selected.' };
  }

  let notifyDueAt: Date | null = null;
  const parts: string[] = [];

  if (category.notifyWithinHours) {
    notifyDueAt = new Date(awareAt.getTime() + category.notifyWithinHours * 3_600_000);
    parts.push(`notify within ${category.notifyWithinHours} hours`);
  } else if (category.notifyWithinBusinessDays) {
    notifyDueAt = addBusinessDays(awareAt, category.notifyWithinBusinessDays);
    parts.push(`notify within ${category.notifyWithinBusinessDays} business days`);
  }

  let reportDueAt: Date | null = null;
  if (category.detailedReportBusinessDays) {
    reportDueAt = addBusinessDays(awareAt, category.detailedReportBusinessDays);
    parts.push(`detailed report within ${category.detailedReportBusinessDays} business days`);
  }

  return {
    notifyDueAt,
    reportDueAt,
    basis: `${category.label}: ${parts.join(', ')} of becoming aware.`,
  };
}
