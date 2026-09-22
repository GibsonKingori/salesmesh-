import React from 'react';

const STAGE_STYLES = {
  lead: 'bg-slate-500/10 text-slate-300 ring-slate-400/20',
  qualified: 'bg-sky-500/10 text-sky-300 ring-sky-400/20',
  proposal: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  negotiation: 'bg-violet-500/10 text-violet-300 ring-violet-400/20',
  won: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  lost: 'bg-red-500/10 text-red-300 ring-red-400/20',
};

const DOT_STYLES = {
  lead: 'bg-slate-400',
  qualified: 'bg-sky-400',
  proposal: 'bg-amber-400',
  negotiation: 'bg-violet-400',
  won: 'bg-emerald-400',
  lost: 'bg-red-400',
};

export default function StageBadge({ stage }) {
  const style = STAGE_STYLES[stage] || STAGE_STYLES.lead;
  const dot = DOT_STYLES[stage] || DOT_STYLES.lead;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${style}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {stage}
    </span>
  );
}
