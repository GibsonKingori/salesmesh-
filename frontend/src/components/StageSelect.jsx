import React from 'react';
import { STAGE_STYLES } from './StageBadge.jsx';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

// Looks like a StageBadge but lets the owner move the deal to another stage.
export default function StageSelect({ stage, onChange, disabled }) {
  const style = STAGE_STYLES[stage] || STAGE_STYLES.lead;
  return (
    <div className="relative">
      <select
        value={stage}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Deal stage"
        className={`cursor-pointer appearance-none rounded-full py-1 pl-2.5 pr-7 text-xs font-medium capitalize outline-none ring-1 ring-inset transition-opacity focus:ring-2 focus:ring-brand-500/40 disabled:cursor-wait disabled:opacity-50 ${style}`}
      >
        {STAGES.map((s) => (
          <option key={s} value={s} className="bg-surface capitalize text-fg">
            {s}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 opacity-70"
      >
        <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
      </svg>
    </div>
  );
}
