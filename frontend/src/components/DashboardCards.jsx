import React from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from './DashboardShell.jsx';
import StageBadge from './StageBadge.jsx';
import EmptyState from './EmptyState.jsx';
import ConversionFunnelChart from './ConversionFunnelChart.jsx';
import { currency, currencyShort } from '../lib/format.js';

// Building blocks shared by the manager and representative dashboards

export const Card = ({ title, subtitle, action, children, className = '' }) => (
  <div className={`rounded-2xl border border-fg/10 bg-surface p-5 shadow-sm shadow-ink-900/5 ${className}`}>
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

export const CardLink = ({ to, children }) => (
  <Link to={to} className="shrink-0 text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
    {children}
  </Link>
);

// Loading and error states, so each dashboard only renders once its data is in
export function DashboardState({ title, error }) {
  return (
    <DashboardShell title={title}>
      {error ? (
        <div className="rounded-md border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
      ) : (
        <div className="py-20 text-center text-sm text-muted">Loading…</div>
      )}
    </DashboardShell>
  );
}

export function FunnelCard({ title = 'Conversion funnel', diagnostic }) {
  const hasTargets = diagnostic.transitions.some((t) => t.expectedRate !== null);
  return (
    <Card title={title} subtitle={hasTargets ? 'Compared against the conversion targets' : 'Your admin hasn’t set conversion targets yet'}>
      <ConversionFunnelChart stages={diagnostic.stages} transitions={diagnostic.transitions} />
    </Card>
  );
}

export function ForecastCard({ predictive, velocity }) {
  const subtitle =
    predictive.basis === 'no_won_deals'
      ? 'Trend-based — needs won deals to project from.'
      : predictive.basis === 'insufficient_history'
        ? 'Trend-based — needs deals won on different days to spot a trend.'
        : `Trend-based, ~${currencyShort(predictive.dailyRate)}/day`;

  return (
    <Card title="Revenue forecast" subtitle={subtitle}>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${predictive.horizons.length}, minmax(0, 1fr))` }}>
        {predictive.horizons.map((h) => (
          <div key={h.days} className="min-w-0 rounded-xl border border-fg/10 bg-fg/[0.02] px-2 py-3 text-center" title={currency(h.value)}>
            <p className="text-xs uppercase tracking-wide text-subtle">{h.days} days</p>
            <p className="mt-1 break-words font-display text-base font-bold leading-tight tabular-nums text-fg sm:text-lg">
              {currencyShort(h.value)}
            </p>
          </div>
        ))}
      </div>
      {velocity.velocity > 0 && (
        <p className="mt-4 text-xs text-subtle">
          Pipeline velocity: <span className="text-fg-soft" title={currency(velocity.velocity)}>{currencyShort(velocity.velocity)}/day</span>
          {' · '}avg cycle {Math.round(velocity.avgSalesCycleLength)} days
        </p>
      )}
    </Card>
  );
}

// Ranked open deals. `ownerNames` (id → name) adds an owner column on the team view.
export function PriorityDealsCard({ title, subtitle, deals, dealsPath, ownerNames, emptyDescription }) {
  return (
    <Card title={title} subtitle={subtitle} action={<CardLink to={dealsPath}>View all deals →</CardLink>}>
      {deals.length === 0 ? (
        <EmptyState title="No open deals" description={emptyDescription} />
      ) : (
        <ul className="-mx-5 -mb-5 divide-y divide-fg/5">
          {deals.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-8 shrink-0 text-center text-xs font-bold text-muted" title="Priority score">
                  {Math.round(d.priority_score)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{d.title}</p>
                  {ownerNames && <p className="truncate text-xs text-subtle">{ownerNames[d.owner_id] || 'Unassigned'}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="hidden text-sm text-muted sm:inline">{currency(d.value)}</span>
                <StageBadge stage={d.stage} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
