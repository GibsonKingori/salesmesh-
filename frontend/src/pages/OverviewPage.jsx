import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import DashboardShell from '../components/DashboardShell.jsx';
import StatCard from '../components/StatCard.jsx';
import StageBadge from '../components/StageBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConversionFunnelChart from '../components/ConversionFunnelChart.jsx';
import { ICONS } from '../components/icons.jsx';
import { currency, percent } from '../lib/format.js';

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
  const canEditTargets = ['manager', 'admin'].includes(user?.role);

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

  return (
    <DashboardShell title={title}>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={isTeam ? 'Pipeline value' : 'My pipeline value'}
          value={currency(descriptive.totalValue)}
          hint={`${descriptive.totalDeals} total deals`}
          icon={ICONS.pipeline}
        />
        <StatCard label="Open deals" value={descriptive.openCount} hint="Not yet won or lost" icon={ICONS.open} tone="sky" />
        <StatCard
          label="Won value"
          value={currency(descriptive.wonValue)}
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
              ? 'Compared against the targets set in Settings'
              : canEditTargets
                ? 'No conversion targets set yet'
                : 'Your manager hasn’t set conversion targets yet'
          }
          action={
            canEditTargets && (
              <Link to="/manager/settings" className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
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
                : `Trend-based, ~${currency(predictive.dailyRate)}/day`
          }
        >
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${predictive.horizons.length}, minmax(0, 1fr))` }}>
            {predictive.horizons.map((h) => (
              <div key={h.days} className="rounded-xl border border-fg/10 bg-fg/[0.02] p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-subtle">{h.days}d</p>
                <p className="mt-1 font-display text-lg font-bold text-fg">{currency(h.value)}</p>
              </div>
            ))}
          </div>
          {velocity.velocity > 0 && (
            <p className="mt-4 text-xs text-subtle">
              Pipeline velocity: <span className="text-fg-soft">{currency(velocity.velocity)}/day</span>
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
