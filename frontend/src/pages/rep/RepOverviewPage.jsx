import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DashboardShell from '../../components/DashboardShell.jsx';
import StatCard from '../../components/StatCard.jsx';
import StageBadge from '../../components/StageBadge.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { Card, CardLink, DashboardState, FunnelCard, PriorityDealsCard } from '../../components/DashboardCards.jsx';
import { ICONS } from '../../components/icons.jsx';
import { currency, currencyShort, formatDate, percent } from '../../lib/format.js';

const FOCUS_COUNT = 5;
const ATTENTION_COUNT = 6;
const TITLE = 'My dashboard';

const ACTIVITY_LABELS = { call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note', stage_change: 'Stage change' };

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

const daysFromToday = (date) => Math.round((new Date(`${date}T00:00:00`) - new Date(new Date().toDateString())) / 86_400_000);

function dueLabel(date) {
  const days = daysFromToday(date);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

// Sales Representative "My Dashboard": the rep's own targets and what to work on next —
// deals slipping past their close date, today's priorities, and their latest logged activity
export default function RepOverviewPage() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [focusDeals, setFocusDeals] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/analytics/me'), api.get('/deals/priority', { params: { limit: FOCUS_COUNT, offset: 0 } })])
      .then(([a, p]) => {
        setAnalytics(a.data);
        setFocusDeals(p.data.deals.slice(0, FOCUS_COUNT));
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load your dashboard'));
  }, []);

  if (error || !analytics) return <DashboardState title={TITLE} error={error} />;

  const { descriptive, diagnostic, attention, recentActivities } = analytics;
  const closedCount = descriptive.wonCount + descriptive.lostCount;
  const winRate = closedCount > 0 ? descriptive.wonCount / closedCount : null;
  const openValue = ['lead', 'qualified', 'proposal', 'negotiation'].reduce((s, st) => s + descriptive.byStage[st].value, 0);
  const attentionDeals = [...attention.overdue, ...attention.closingSoon];
  const firstName = user?.name?.split(' ')[0] || '';

  return (
    <DashboardShell title={TITLE}>
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-fg">
          {greeting()}{firstName && `, ${firstName}`}
        </h1>
        <p className="text-sm text-muted">
          {attention.overdue.length > 0
            ? `${attention.overdue.length} of your deals ${attention.overdue.length === 1 ? 'is' : 'are'} past the expected close date.`
            : attention.closingSoon.length > 0
              ? `${attention.closingSoon.length} deal${attention.closingSoon.length === 1 ? '' : 's'} due to close in the next ${attention.soonDays} days.`
              : 'Nothing overdue. Here’s where your pipeline stands.'}
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="My open pipeline"
          value={currencyShort(openValue)}
          fullValue={currency(openValue)}
          hint={`${descriptive.openCount} open deal${descriptive.openCount === 1 ? '' : 's'}`}
          icon={ICONS.pipeline}
        />
        <StatCard
          label="Closing soon"
          value={attention.closingSoon.length}
          hint={`Due in the next ${attention.soonDays} days`}
          icon={ICONS.open}
          tone="sky"
        />
        <StatCard
          label="Overdue"
          value={attention.overdue.length}
          hint="Past expected close date"
          icon={ICONS.alert}
          tone="gold"
        />
        <StatCard
          label="My win rate"
          value={percent(winRate)}
          hint={closedCount ? `${descriptive.wonCount} won · ${currencyShort(descriptive.wonValue)}` : 'No closed deals yet'}
          icon={ICONS.won}
          tone="emerald"
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Needs attention"
          subtitle={`Overdue, or due within ${attention.soonDays} days`}
          action={attentionDeals.length > ATTENTION_COUNT && <CardLink to="/rep/deals">See all {attentionDeals.length} →</CardLink>}
        >
          {attentionDeals.length === 0 ? (
            <EmptyState title="You’re on track" description="No open deals are overdue or due to close soon." />
          ) : (
            <ul className="-mx-5 -mb-5 divide-y divide-fg/5">
              {attentionDeals.slice(0, ATTENTION_COUNT).map((d) => {
                const overdue = daysFromToday(d.expected_close_date) < 0;
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{d.title}</p>
                      <p className={`text-xs ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-subtle'}`}>
                        {dueLabel(d.expected_close_date)} · {formatDate(d.expected_close_date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="hidden text-sm text-muted sm:inline">{currencyShort(d.value)}</span>
                      <StageBadge stage={d.stage} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <PriorityDealsCard
          title="Today’s focus"
          subtitle="Your open deals ranked by stage, urgency, and value"
          deals={focusDeals}
          dealsPath="/rep/deals"
          emptyDescription="Add or import deals on the Deals page."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FunnelCard title="My pipeline" diagnostic={diagnostic} />

        <Card title="My recent activity" subtitle="Calls, emails, meetings and notes you’ve logged">
          {recentActivities.length === 0 ? (
            <EmptyState title="No activity logged yet" description="Open a deal on the Deals page to log a call, email, meeting or note." />
          ) : (
            <ul className="-mx-5 -mb-5 divide-y divide-fg/5">
              {recentActivities.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium text-fg">
                      <span className="mr-2 rounded bg-fg/5 px-1.5 py-0.5 text-xs font-semibold text-fg-soft">
                        {ACTIVITY_LABELS[a.type] || a.type}
                      </span>
                      {a.deal_title || 'Deleted deal'}
                    </p>
                    <span className="shrink-0 text-xs text-subtle">{formatDate(a.created_at)}</span>
                  </div>
                  {a.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{a.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
