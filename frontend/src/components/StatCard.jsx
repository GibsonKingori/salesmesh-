import React from 'react';

// Solid icon tiles, one colour per metric so the row scans at a glance
const TONES = {
  brand: 'from-brand-500 to-brand-700 shadow-brand-600/30',
  sky: 'from-sky-500 to-sky-700 shadow-sky-600/30',
  emerald: 'from-emerald-500 to-emerald-700 shadow-emerald-600/30',
  gold: 'from-accent-400 to-accent-600 shadow-accent-500/30',
};

// Icon sits beside the label; the value gets the full card width so large KES amounts never
// run under the icon
export default function StatCard({ label, value, hint, icon, tone = 'brand' }) {
  return (
    <div className="rounded-2xl border border-fg/10 bg-surface p-5 shadow-sm shadow-ink-900/5 transition-colors hover:border-brand-400/40">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        {icon && (
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${TONES[tone] || TONES.brand}`}
          >
            {icon}
          </div>
        )}
      </div>
      <p className="mt-3 truncate font-display text-[1.75rem] font-bold leading-tight tabular-nums text-fg" title={String(value)}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </div>
  );
}
