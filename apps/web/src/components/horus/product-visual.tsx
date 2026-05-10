'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * The hero "product" — a stylized product surface that hints at what Horus
 * actually does without pretending to be a real screenshot.
 * Modeled after Apple's product imagery: clean, confident, slightly too-perfect.
 */
export function ProductVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'border-hairline bg-paper relative isolate overflow-hidden rounded-3xl border shadow-lg',
        className,
      )}
    >
      {/* Window chrome */}
      <div className="border-hairline bg-paper-soft/60 flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="bg-ink/15 h-2.5 w-2.5 rounded-full" />
          <span className="bg-ink/15 h-2.5 w-2.5 rounded-full" />
          <span className="bg-ink/15 h-2.5 w-2.5 rounded-full" />
        </div>
        <div className="bg-paper text-ink-faded flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          horus.api / v1 / answer
        </div>
        <div className="font-technical text-ink-mute text-[10px] tracking-wider">
          218ms · 1,442 toks
        </div>
      </div>

      <div className="bg-hairline grid gap-px md:grid-cols-[1fr_280px]">
        {/* Conversation column */}
        <div className="bg-paper space-y-5 p-6">
          <div>
            <div className="text-ink-mute text-[11px] font-medium uppercase tracking-[0.18em]">
              You
            </div>
            <div className="text-ink mt-1.5 text-[15px] leading-relaxed">
              Summarize Q3 underwriting risk across the portfolio. Cite sources.
            </div>
          </div>

          <div className="bg-paper-soft rounded-2xl p-5">
            <div className="text-ink-faded flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]">
              <span className="bg-accent h-1 w-1 rounded-full" />
              Horus
            </div>
            <p className="text-ink mt-2 text-[15px] leading-relaxed">
              Aggregate exposure rose <span className="num font-semibold">11.4%</span> QoQ, driven
              by three concentrations in mid-market real estate
              <Cite n={1} />. Default probability remains within tolerance
              <Cite n={2} />, though correlation to commercial debt has tightened
              <span className="num">0.18→0.27</span>
              <Cite n={3} />.
              <span className="bg-ink/70 animate-cursor ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] align-middle" />
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <SourceChip label="Q3-portfolio.pdf" page={14} />
              <SourceChip label="risk-policy-v2.docx" page={3} />
              <SourceChip label="Bloomberg feed" page={null} live />
            </div>
          </div>
        </div>

        {/* Side: graph + telemetry */}
        <div className="bg-paper space-y-5 p-6">
          <div>
            <div className="eyebrow mb-3">Knowledge graph</div>
            <GraphSketch />
          </div>

          <div className="space-y-2">
            <div className="eyebrow mb-2">Telemetry</div>
            {[
              ['Retrieval', '38ms'],
              ['Reasoning', '162ms'],
              ['Synthesis', '18ms'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-faded">{k}</span>
                <span className="num text-ink font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup className="bg-accent/12 text-accent ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold">
      {n}
    </sup>
  );
}

function SourceChip({ label, page, live }: { label: string; page: number | null; live?: boolean }) {
  return (
    <span className="border-hairline bg-paper text-ink-soft inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
      {live ? (
        <span className="animate-pulse-soft h-1.5 w-1.5 rounded-full bg-emerald-500" />
      ) : (
        <svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="9" height="10" rx="1.5" className="stroke-ink-mute" />
          <line x1="2.5" y1="3.5" x2="7.5" y2="3.5" className="stroke-ink-mute" />
          <line x1="2.5" y1="5.5" x2="7.5" y2="5.5" className="stroke-ink-mute" />
        </svg>
      )}
      <span className="text-ink truncate font-medium">{label}</span>
      {page && <span className="text-ink-faded">· p{page}</span>}
    </span>
  );
}

function GraphSketch() {
  return (
    <svg viewBox="0 0 240 160" className="w-full">
      <defs>
        <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(220 100% 60%)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="hsl(220 100% 60%)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* edges */}
      <g className="stroke-hairline-strong" fill="none" strokeWidth="1">
        <path d="M 60 80 L 120 40" />
        <path d="M 60 80 L 130 110" />
        <path d="M 120 40 L 180 70" />
        <path d="M 130 110 L 180 70" />
        <path d="M 130 110 L 200 130" />
        <path d="M 180 70 L 200 130" />
      </g>

      {/* central node */}
      <circle cx="120" cy="80" r="22" fill="url(#node-glow)" />
      <circle cx="120" cy="80" r="9" className="fill-ink" />
      <circle cx="120" cy="80" r="9" className="stroke-paper fill-none" strokeWidth="2" />

      {/* satellite nodes */}
      {[
        [60, 80],
        [120, 40],
        [180, 70],
        [130, 110],
        [200, 130],
      ].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="5" className="fill-paper stroke-ink" strokeWidth="1.5" />
        </g>
      ))}

      {/* labels */}
      <text
        x="120"
        y="80"
        textAnchor="middle"
        dy="3"
        className="fill-paper"
        fontSize="7"
        fontWeight="600"
        fontFamily="var(--font-technical)"
      >
        Q3
      </text>
      <text
        x="60"
        y="74"
        textAnchor="middle"
        className="fill-ink-faded"
        fontSize="8"
        fontFamily="var(--font-technical)"
      >
        portfolio
      </text>
      <text
        x="120"
        y="32"
        textAnchor="middle"
        className="fill-ink-faded"
        fontSize="8"
        fontFamily="var(--font-technical)"
      >
        policy
      </text>
      <text
        x="186"
        y="64"
        textAnchor="middle"
        className="fill-ink-faded"
        fontSize="8"
        fontFamily="var(--font-technical)"
      >
        risk
      </text>
      <text
        x="130"
        y="124"
        textAnchor="middle"
        className="fill-ink-faded"
        fontSize="8"
        fontFamily="var(--font-technical)"
      >
        debt
      </text>
      <text
        x="200"
        y="144"
        textAnchor="middle"
        className="fill-ink-faded"
        fontSize="8"
        fontFamily="var(--font-technical)"
      >
        feed
      </text>
    </svg>
  );
}
