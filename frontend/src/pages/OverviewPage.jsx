import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import DashboardShell from '../components/DashboardShell.jsx';
import StatCard from '../components/StatCard.jsx';
import { downloadCsv } from '../lib/csv.js';
import StageBadge from '../components/StageBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConversionFunnelChart from '../components/ConversionFunnelChart.jsx';
import { ICONS } from '../components/icons.jsx';
import { currency, currencyShort, percent } from '../lib/format.js';

const TOP_PRIORITY_COUNT = 5;

const Card = ({ title, subtitle, action, children }) => (
  <div className="rounded-2xl border border-fg/10 bg-surface p-5 shadow-sm shadow-ink-900/5">
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

// Overview for both roles: managers see the team (/analytics/pipeline), reps see their own
// deals (/analytics/me). Every number comes from the API.
export default function OverviewPage({ scope }) {
  const { user } = useAuth();
  const isTeam = scope === 'team';
  const basePath = isTeam ? '/manager' : '/rep';
  // System Configuration (conversion targets) is an Administrator use case
  const canEditTargets = user?.role === 'admin';

  const [analytics, setAnalytics] = useState(null);
  const [topDeals, setTopDeals] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get(isTeam ? '/analytics/pipeline' : '/analytics/me'), api.get('/deals/priority')])
      .then(([a, p]) => {
        setAnalytics(a.data);
        setTopDeals(p.data.deals.slice(0, TOP_PRIORITY_COUNT));
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load analytics'));
  }, [isTeam]);

  const title = isTeam ? 'Team overview' : 'My overview';

  if (error) {
    return (
      <DashboardShell title={title}>
        <div className="rounded-md border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
      </DashboardShell>
    );
  }

  if (!analytics) {
    return (
      <DashboardShell title={title}>
        <div className="py-20 text-center text-sm text-muted">Loading…</div>
      </DashboardShell>
    );
  }

  const { descriptive, diagnostic, predictive, velocity } = analytics;
  const closedCount = descriptive.wonCount + descriptive.lostCount;
  const winRate = closedCount > 0 ? descriptive.wonCount / closedCount : null;
  const hasTargets = diagnostic.transitions.some((t) => t.expectedRate !== null);

  // "Export Report" use case: KPIs, funnel, forecast and top deals in one CSV
  const exportReport = () => {
    const rows = [
      ['Summary', 'Pipeline value (KES)', descriptive.totalValue],
      ['Summary', 'Total deals', descriptive.totalDeals],
      ['Summary', 'Open deals', descriptive.openCount],
      ['Summary', 'Won value (KES)', descriptive.wonValue],
      ['Summary', 'Won deals', descriptive.wonCount],
      ['Summary', 'Lost deals', descriptive.lostCount],
      ['Summary', 'Win rate (%)', winRate === null ? '' : Math.round(winRate * 100)],
      ['Summary', 'Pipeline velocity (KES/day)', Math.round(velocity.velocity || 0)],
      ...diagnostic.stages.map((st) => ['Funnel', `Reached ${st.stage}`, st.reached]),
      ...diagnostic.transitions.map((t) => [
        'Conversion',
        `${t.from} → ${t.to} (actual / target %)`,
        `${t.actualRate === null ? '' : Math.round(t.actualRate * 100)} / ${t.expectedRate === null ? '' : Math.round(t.expectedRate * 100)}`,
      ]),
      ...predictive.horizons.map((h) => ['Forecast', `Next ${h.days} days (KES)`, Math.round(h.value)]),
      ...topDeals.map((d) => ['Top priority deal', d.title, d.value]),
    ];
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`salesmesh-sales-report-${today}.csv`, ['Section', 'Metric', 'Value'], rows);
  };

  return (
    <DashboardShell title={title}>
      {isTeam && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={exportReport}
            className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg"
          >
            Export report
          </button>
        </div>
      )}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={isTeam ? 'Pipeline value' : 'My pipeline value'}
          value={currencyShort(descriptive.totalValue)}
          fullValue={currency(descriptive.totalValue)}
          hint={`${descriptive.totalDeals} total deals`}
          icon={ICONS.pipeline}
        />
        <StatCard label="Open deals" value={descriptive.openCount} hint="Not yet won or lost" icon={ICONS.open} tone="sky" />
        <StatCard
          label="Won value"
          value={currencyShort(descriptive.wonValue)}
          fullValue={currency(descriptive.wonValue)}
          hint={`${descriptive.wonCount} deal${descriptive.wonCount === 1 ? '' : 's'} won`}
          icon={ICONS.won}
          tone="emerald"
        />
        <StatCard
          label="Win rate"
          value={percent(winRate)}
          hint={closedCount ? `Of ${closedCount} closed deals` : 'No closed deals yet'}
          icon={ICONS.target}
          tone="gold"
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Conversion funnel"
          subtitle={
            hasTargets
              ? 'Compared against the conversion targets'
              : canEditTargets
                ? 'No conversion targets set yet'
                : 'Your admin hasn’t set conversion targets yet'
          }
          action={
            canEditTargets && (
              <Link to="/admin/configuration" className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
                {hasTargets ? 'Edit targets' : 'Set targets'}
              </Link>
            )
          }
        >
          <ConversionFunnelChart stages={diagnostic.stages} transitions={diagnostic.transitions} />
        </Card>

        <Card
          title="Revenue forecast"
          subtitle={
            predictive.basis === 'no_won_deals'
              ? 'Trend-based — needs won deals to project from.'
              : predictive.basis === 'insufficient_history'
                ? 'Trend-based — needs deals won on different days to spot a trend.'
                : `Trend-based, ~${currencyShort(predictive.dailyRate)}/day`
          }
        >
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
      </div>

      <Card
        title="Top priority deals"
        subtitle="Open deals ranked by stage, urgency, and value"
        action={
          <Link to={`${basePath}/deals`} className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
            View all deals →
          </Link>
        }
      >
        {topDeals.length === 0 ? (
          <EmptyState title="No open deals" description="Add or import deals on the Deals page." />
        ) : (
          <ul className="-mx-5 -mb-5 divide-y divide-fg/5">
            {topDeals.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-8 shrink-0 text-center text-xs font-bold text-muted">
                    {Math.round(d.priority_score)}
                  </span>
                  <span className="truncate text-sm font-medium text-fg">{d.title}</span>
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
    </DashboardShell>
  );
}
