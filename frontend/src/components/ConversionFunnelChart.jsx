import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TooltipCard = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-fg/10 bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="font-medium capitalize text-fg">{label}</p>
      <p className="text-muted">{payload[0].value} sales record{payload[0].value === 1 ? '' : 's'} at this stage</p>
    </div>
  );
};

export default function ConversionFunnelChart({ stages, transitions }) {
  if (stages.length === 0) return <p className="py-8 text-center text-sm text-muted">Add sales records to see your pipeline.</p>;
  return (
    <div>
      {/* Axis labels use currentColor, so they follow the theme's muted text colour */}
      <div className="thin-scrollbar overflow-x-auto">
        <div className="h-56 text-muted" style={{ minWidth: `${Math.max(560, stages.length * 120)}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stages} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="funnelBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#26d3a0" />
                  <stop offset="100%" stopColor="#04775b" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(114,135,135,0.2)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'rgba(114,135,135,0.3)' }} />
              <YAxis tick={{ fill: 'currentColor', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<TooltipCard />} cursor={{ fill: 'rgba(114,135,135,0.08)' }} />
              <Bar dataKey="count" fill="url(#funnelBar)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {stages.map((stage) => (
          <li key={stage.id} className="flex items-center justify-between gap-2 rounded-lg bg-fg/[0.03] px-3 py-2">
            <span className="truncate text-muted">{stage.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-fg">{stage.count}</span>
          </li>
        ))}
      </ul>
      {transitions.length > 0 && (
        <details className="mt-3 border-t border-fg/10 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">Show conversion details</summary>
          <p className="mt-2 text-xs text-subtle">Conversion rate is the share of sales records that reached the next step.</p>
          <ul className="mt-2 space-y-2">
            {transitions.map((transition) => (
              <li key={transition.transition} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted">{transition.fromLabel} <span className="text-faint">&rarr;</span> {transition.toLabel}</span>
                <span className="flex items-center gap-2">
                  <span className="text-fg">{transition.actualRate === null ? '—' : `${Math.round(transition.actualRate * 100)}%`}</span>
                  {transition.underperforming && (
                    <span className="text-xs text-amber-700 dark:text-amber-300">below {Math.round(transition.expectedRate * 100)}% target</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
