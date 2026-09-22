import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TooltipCard = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="font-medium capitalize text-slate-200">{label}</p>
      <p className="text-slate-400">{payload[0].value} deal{payload[0].value === 1 ? '' : 's'} reached</p>
    </div>
  );
};

export default function ConversionFunnelChart({ stages, transitions }) {
  return (
    <div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stages} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="stage" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<TooltipCard />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="reached" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 space-y-2">
        {transitions.map((t) => (
          <li key={`${t.from}-${t.to}`} className="flex items-center justify-between text-sm">
            <span className="capitalize text-slate-400">
              {t.from} <span className="text-slate-600">&rarr;</span> {t.to}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-slate-200">{t.actualRate === null ? '—' : `${Math.round(t.actualRate * 100)}%`}</span>
              {t.underperforming && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-400/20">
                  below {Math.round(t.expectedRate * 100)}% benchmark
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
