import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TooltipCard = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-fg/10 bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="font-medium capitalize text-fg">{label}</p>
      <p className="text-muted">{payload[0].value} deal{payload[0].value === 1 ? '' : 's'} reached</p>
    </div>
  );
};

export default function ConversionFunnelChart({ stages, transitions }) {
  return (
    <div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stages} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="funnelBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#26d3a0" />
                <stop offset="100%" stopColor="#04775b" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(114,135,135,0.2)" vertical={false} />
            <XAxis dataKey="stage" tick={{ fill: '#526767', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'rgba(114,135,135,0.3)' }} />
            <YAxis tick={{ fill: '#526767', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<TooltipCard />} cursor={{ fill: 'rgba(114,135,135,0.08)' }} />
            <Bar dataKey="reached" fill="url(#funnelBar)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 space-y-2">
        {transitions.map((t) => (
          <li key={`${t.from}-${t.to}`} className="flex items-center justify-between text-sm">
            <span className="capitalize text-muted">
              {t.from} <span className="text-faint">&rarr;</span> {t.to}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-fg">{t.actualRate === null ? '—' : `${Math.round(t.actualRate * 100)}%`}</span>
              {t.underperforming && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-400/20">
                  below {Math.round(t.expectedRate * 100)}% target
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
