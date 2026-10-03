import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import DashboardShell from '../components/DashboardShell.jsx';
import StageSelect from '../components/StageSelect.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AddDealModal from '../components/AddDealModal.jsx';
import ImportCsvModal from '../components/ImportCsvModal.jsx';
import DealDrawer from '../components/DealDrawer.jsx';
import PipelineBoard from '../components/PipelineBoard.jsx';
import { currency, formatDate } from '../lib/format.js';

const priorityRingClass = (score) => {
  if (score >= 70) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-400/30';
  if (score >= 40) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-400/30';
  return 'bg-ink-500/10 text-muted ring-ink-400/20';
};

const VIEWS = [
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
];

// The chosen view is a per-browser preference; storage can be unavailable (private mode)
const VIEW_KEY = 'salesmesh_deals_view';
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list';
  } catch {
    return 'list';
  }
};

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

// Deals list for both roles; the API scopes it (reps: own deals, managers: whole team)
export default function DealsPage({ scope }) {
  const isTeam = scope === 'team';
  const [deals, setDeals] = useState([]);
  const [priorityDeals, setPriorityDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('open');
  const [savingId, setSavingId] = useState(null);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [view, setView] = useState(readView);

  const changeView = (next) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* preference just isn't remembered */
    }
  };

  // silent: refresh after an edit without swapping the list for the loading state
  const fetchAll = ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    return Promise.all([api.get('/deals'), api.get('/deals/priority')])
      .then(([all, ranked]) => {
        setDeals(all.data.deals);
        setPriorityDeals(ranked.data.deals);
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load your deals'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleStageChange = async (deal, stage) => {
    if (stage === deal.stage) return;
    setError('');
    setSavingId(deal.id);
    // Move it right away so the board feels instant; the refetch below corrects anything else
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage } : d)));
    try {
      await api.patch(`/deals/${deal.id}`, { stage });
      // Refetch rather than patch locally: priority scores depend on the whole open set
      await fetchAll({ silent: true });
    } catch (err) {
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: deal.stage } : d)));
      setError(err.response?.data?.error || 'Could not update the deal stage');
    } finally {
      setSavingId(null);
    }
  };

  const closedDeals = deals
    .filter((d) => ['won', 'lost'].includes(d.stage))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const tabCounts = { open: priorityDeals.length, closed: closedDeals.length };
  const scores = Object.fromEntries(priorityDeals.map((d) => [d.id, d.priority_score]));

  return (
    <DashboardShell title={isTeam ? 'Team deals' : 'My deals'}>
      <div className="rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fg/10 px-5 py-4">
          <div>
            <h2 className="font-display font-semibold text-fg">
              {view === 'board' ? (isTeam ? 'Team pipeline' : 'Your pipeline') : tab === 'open' ? (isTeam ? 'Team deals, by priority' : 'Your deals, by priority') : 'Closed deals'}
            </h2>
            <p className="mt-0.5 text-xs text-subtle">
              {view === 'board'
                ? 'Drag a deal to another column to change its stage'
                : tab === 'open'
                ? 'Ranked by stage, urgency, and value — highest first'
                : 'Won and lost, most recently closed first'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-fg/10 bg-fg/5 p-0.5" role="group" aria-label="Deals view">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => changeView(v.id)}
                  aria-pressed={view === v.id}
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                    view === v.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:border-fg/20 hover:bg-fg/10 hover:text-fg"
            >
              Import CSV
            </button>
            <button
              onClick={() => setShowAddDeal(true)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
            >
              + Add deal
            </button>
          </div>
        </div>

        {view === 'list' && (
          <div className="flex gap-1 border-b border-fg/10 px-5" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-brand-400 text-fg'
                    : 'border-transparent text-muted hover:text-fg'
                }`}
              >
                {t.label}
                {!loading && <span className="ml-1.5 text-xs text-subtle">{tabCounts[t.id]}</span>}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mx-5 mt-4 flex items-center justify-between rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-xs text-red-700 dark:text-red-300/70 hover:text-red-800 dark:hover:text-red-200">
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted">Loading deals…</div>
        ) : view === 'board' ? (
          <PipelineBoard
            deals={deals}
            scores={scores}
            savingId={savingId}
            onMove={handleStageChange}
            onOpen={setSelectedDeal}
          />
        ) : tab === 'open' ? (
          priorityDeals.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title={isTeam ? 'No open deals yet' : 'No open deals assigned to you yet'}
                description="Add your first deal or import a CSV of existing deals to get started."
              />
            </div>
          ) : (
            <ul className="divide-y divide-fg/5">
              {priorityDeals.map((d) => (
                <li
                  key={d.id}
                  onClick={() => setSelectedDeal(d)}
                  className="flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors hover:bg-fg/[0.03]"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1 ring-inset ${priorityRingClass(d.priority_score)}`}
                    >
                      {Math.round(d.priority_score)}
                    </span>
                    <button className="text-left text-sm font-medium text-fg hover:text-fg">{d.title}</button>
                  </div>
                  <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                    <span className="text-sm text-muted">{currency(d.value)}</span>
                    <StageSelect
                      stage={d.stage}
                      disabled={savingId === d.id}
                      onChange={(stage) => handleStageChange(d, stage)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : closedDeals.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title="No closed deals yet"
              description="Deals you mark as won or lost will show up here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-fg/5">
            {closedDeals.map((d) => (
              <li
                  key={d.id}
                  onClick={() => setSelectedDeal(d)}
                  className="flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors hover:bg-fg/[0.03]"
                >
                <div>
                  <button className="text-left text-sm font-medium text-fg hover:text-fg">{d.title}</button>
                  <p className="mt-0.5 text-xs text-subtle">
                    Closed {formatDate(d.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                  <span className="text-sm text-muted">{currency(d.value)}</span>
                  {/* Still editable, so a deal closed by mistake can be reopened */}
                  <StageSelect
                    stage={d.stage}
                    disabled={savingId === d.id}
                    onChange={(stage) => handleStageChange(d, stage)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddDeal && (
        <AddDealModal
          onClose={() => setShowAddDeal(false)}
          onCreated={() => {
            setShowAddDeal(false);
            fetchAll();
          }}
        />
      )}

      {selectedDeal && (
        <DealDrawer
          key={selectedDeal.id}
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onChanged={() => fetchAll({ silent: true })}
        />
      )}

      {showImport && (
        <ImportCsvModal
          onClose={() => setShowImport(false)}
          onImported={() => fetchAll()}
        />
      )}
    </DashboardShell>
  );
}
