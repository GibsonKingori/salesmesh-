import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import StatCard from '../../components/StatCard.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { Card, DashboardState, ForecastCard, FunnelCard, PriorityDealsCard } from '../../components/DashboardCards.jsx';
import { ICONS } from '../../components/icons.jsx';
import { downloadCsv } from '../../lib/csv.js';
import { currency, currencyShort, percent } from '../../lib/format.js';

const TOP_PRIORITY_COUNT = 5;
const TITLE = 'Team overview';

// Sales Manager "View Dashboard/KPI" + "Pipeline Analytics" + "Export Report": the numbers for
// the representatives assigned to this manager (never another manager's team), how each rep is
// doing, and the deals the team should push next
export default function ManagerOverviewPage() {
  const [analytics, setAnalytics] = useState(null);
  const [topDeals, setTopDeals] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/analytics/pipeline'), api.get('/deals/priority', { params: { limit: TOP_PRIORITY_COUNT, offset: 0 } })])
      .then(([a, p]) => {
        setAnalytics(a.data);
        setTopDeals(p.data.deals.slice(0, TOP_PRIORITY_COUNT));
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load analytics'));
  }, []);

  const ownerNames = useMemo(() => Object.fromEntries((analytics?.team || []).map((r) => [r.id, r.name])), [analytics]);

  if (error || !analytics) return <DashboardState title={TITLE} error={error} />;

  const { descriptive, diagnostic, predictive, velocity, team } = analytics;
  const closedCount = descriptive.wonCount + descriptive.lostCount;
  const winRate = closedCount > 0 ? descriptive.wonCount / closedCount : null;
  // The table can include the manager's own row if they own deals; the headline counts reps only
  const reps = team.filter((r) => r.role === 'representative');
  const activeReps = reps.filter((r) => r.openCount > 0).length;

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
      ...team.flatMap((r) => [
        ['Team', `${r.name}: open deals / open value (KES)`, `${r.openCount} / ${r.openValue}`],
        ['Team', `${r.name}: won deals / won value (KES)`, `${r.wonCount} / ${r.wonValue}`],
        ['Team', `${r.name}: win rate (%)`, r.winRate === null ? '' : Math.round(r.winRate * 100)],
      ]),
      ...topDeals.map((d) => ['Top priority deal', d.title, d.value]),
    ];
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`salesmesh-sales-report-${today}.csv`, ['Section', 'Metric', 'Value'], rows);
  };

  return (
    <DashboardShell title={TITLE}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-fg">My team</h1>
          <p className="text-sm text-muted">
            {reps.length
              ? `${reps.length} representative${reps.length === 1 ? '' : 's'} · ${activeReps} with open deals`
              : 'No representatives are assigned to you yet'}
          </p>
        </div>
        <button
          onClick={exportReport}
          className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg"
        >
          Export report
        </button>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Team pipeline"
          value={currencyShort(descriptive.totalValue)}
          fullValue={currency(descriptive.totalValue)}
          hint={`${descriptive.totalDeals} total deals`}
          icon={ICONS.pipeline}
        />
        <StatCard label="Open deals" value={descriptive.openCount} hint="Across the whole team" icon={ICONS.open} tone="sky" />
        <StatCard
          label="Won value"
          value={currencyShort(descriptive.wonValue)}
          fullValue={currency(descriptive.wonValue)}
          hint={`${descriptive.wonCount} deal${descriptive.wonCount === 1 ? '' : 's'} won`}
          icon={ICONS.won}
          tone="emerald"
        />
        <StatCard
          label="Team win rate"
          value={percent(winRate)}
          hint={closedCount ? `Of ${closedCount} closed deals` : 'No closed deals yet'}
          icon={ICONS.target}
          tone="gold"
        />
      </div>

      <Card title="Representatives" subtitle="Ranked by won value" className="mb-8">
        {team.length === 0 ? (
          <EmptyState title="No representatives in your team yet" description="Your company admin assigns representatives to you on the Accounts page." />
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y border-fg/10 text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-5 py-2 font-semibold">Representative</th>
                  <th className="px-3 py-2 text-right font-semibold">Open</th>
                  <th className="px-3 py-2 text-right font-semibold">Open value</th>
                  <th className="px-3 py-2 text-right font-semibold">Won</th>
                  <th className="px-3 py-2 text-right font-semibold">Won value</th>
                  <th className="px-5 py-2 text-right font-semibold">Win rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fg/5">
                {team.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3 font-medium text-fg">
                      {r.name}
                      {r.role !== 'representative' && <span className="ml-2 text-xs font-normal text-subtle">({r.role})</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg-soft">{r.openCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg-soft" title={currency(r.openValue)}>{currencyShort(r.openValue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg-soft">{r.wonCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-fg" title={currency(r.wonValue)}>{currencyShort(r.wonValue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-fg-soft">{percent(r.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FunnelCard title="Team conversion funnel" diagnostic={diagnostic} />
        <ForecastCard predictive={predictive} velocity={velocity} />
      </div>

      <PriorityDealsCard
        title="Top priority deals across the team"
        subtitle="Open deals ranked by stage, urgency, and value"
        deals={topDeals}
        dealsPath="/manager/deals"
        ownerNames={ownerNames}
        emptyDescription="Add or import deals on the Deals page."
      />
    </DashboardShell>
  );
}
