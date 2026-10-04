import React, { useEffect, useRef, useState } from 'react';
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

const PAGE_SIZE = 25;
const NO_FILTERS = { q: '', owner_id: '', campaign_id: '' };
const EMPTY_LIST = { deals: [], total: 0, pages: 1 };

const selectClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-fg outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';

// Loads `pages` pages of the open (priority-ranked) or closed list starting at page `from`,
// or the whole list when pages is null. Reloading every loaded page keeps "Load more"
// results after an edit.
async function fetchList(kind, filters, pages, from = 0) {
  const url = kind === 'open' ? '/deals/priority' : '/deals';
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  if (kind === 'closed') params.status = 'closed';

  if (pages === null) {
    const { data } = await api.get(url, { params });
    return { deals: data.deals, total: data.total, pages: 1 };
  }
  const responses = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      api.get(url, { params: { ...params, limit: PAGE_SIZE, offset: (from + i) * PAGE_SIZE } })
    )
  );
  return {
    deals: responses.flatMap((r) => r.data.deals),
    total: responses[responses.length - 1].data.total,
    pages,
  };
}

// Deals list for both roles; the API scopes it (reps: own deals, managers: whole team)
export default function DealsPage({ scope }) {
  const isTeam = scope === 'team';
  const [lists, setLists] = useState({ open: EMPTY_LIST, closed: EMPTY_LIST });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [team, setTeam] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  // Only the newest request may update the lists, so slow responses to old searches are dropped
  const requestId = useRef(0);
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

  // silent: refresh after an edit, keeping the pages already loaded and the current list on screen.
  // Otherwise start again from the first page. The board needs every open deal at once.
  const fetchAll = ({ silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent) setLoading(true);
    const pagesOf = (kind) => (silent ? lists[kind].pages : 1);
    return Promise.all([
      fetchList('open', filters, view === 'board' ? null : pagesOf('open')),
      fetchList('closed', filters, pagesOf('closed')),
    ])
      .then(([open, closed]) => {
        if (id === requestId.current) setLists({ open, closed });
      })
      .catch((err) => {
        if (id === requestId.current) setError(err.response?.data?.error || 'Could not load your deals');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  };

  useEffect(() => {
    fetchAll();
  }, [filters, view]);

  // Search as you type, once typing pauses
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    api.get('/campaigns').then((res) => setCampaigns(res.data.campaigns)).catch(() => {});
    if (isTeam) api.get('/users/team').then((res) => setTeam(res.data.users)).catch(() => {});
  }, [isTeam]);

  const loadMore = async (kind) => {
    const id = requestId.current;
    const current = lists[kind];
    setLoadingMore(kind);
    try {
      const next = await fetchList(kind, filters, 1, current.pages);
      if (id !== requestId.current) return;
      setLists((prev) => ({
        ...prev,
        [kind]: { deals: [...prev[kind].deals, ...next.deals], total: next.total, pages: current.pages + 1 },
      }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load more deals');
    } finally {
      setLoadingMore(null);
    }
  };

  const setStageLocally = (id, stage) =>
    setLists((prev) => {
      const move = (list) => ({ ...list, deals: list.deals.map((d) => (d.id === id ? { ...d, stage } : d)) });
      return { open: move(prev.open), closed: move(prev.closed) };
    });

  const handleStageChange = async (deal, stage) => {
    if (stage === deal.stage) return;
    setError('');
    setSavingId(deal.id);
    // Move it right away so the board feels instant; the refetch below corrects anything else
    setStageLocally(deal.id, stage);
    try {
      await api.patch(`/deals/${deal.id}`, { stage });
      // Refetch rather than patch locally: priority scores depend on the whole open set
      await fetchAll({ silent: true });
    } catch (err) {
      setStageLocally(deal.id, deal.stage);
      setError(err.response?.data?.error || 'Could not update the deal stage');
    } finally {
      setSavingId(null);
    }
  };

  const priorityDeals = lists.open.deals;
  const closedDeals = lists.closed.deals;
  const tabCounts = { open: lists.open.total, closed: lists.closed.total };
  const scores = Object.fromEntries(priorityDeals.map((d) => [d.id, d.priority_score]));
  const ownerNames = Object.fromEntries(team.map((u) => [u.id, u.name]));
  const filtersActive = Object.values(filters).some(Boolean) || search.trim() !== '';
  const clearFilters = () => {
    setSearch('');
    setFilters(NO_FILTERS);
  };

  const loadMoreButton = (kind) =>
    lists[kind].deals.length < lists[kind].total && (
      <div className="border-t border-fg/5 px-5 py-3 text-center">
        <button
          onClick={() => loadMore(kind)}
          disabled={loadingMore === kind}
          className="text-sm font-medium text-brand-700 hover:text-brand-800 disabled:opacity-60 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {loadingMore === kind
            ? 'Loading…'
            : `Load more (${lists[kind].deals.length} of ${lists[kind].total} shown)`}
        </button>
      </div>
    );

  const noMatches = (
    <div className="px-5 py-10 text-center text-sm text-muted">
      No deals match these filters.{' '}
      <button onClick={clearFilters} className="font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200">
        Clear filters
      </button>
    </div>
  );

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

        <div className="flex flex-wrap items-center gap-2 border-b border-fg/10 px-5 py-3">
          <input
            type="search"
            placeholder="Search deal titles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${selectClass} w-56 placeholder-faint`}
            aria-label="Search deals"
          />
          {isTeam && team.length > 0 && (
            <select
              value={filters.owner_id}
              onChange={(e) => setFilters({ ...filters, owner_id: e.target.value })}
              className={`${selectClass} appearance-none`}
              aria-label="Filter by owner"
            >
              <option value="" className="bg-surface">Everyone</option>
              {team.map((u) => (
                <option key={u.id} value={u.id} className="bg-surface">
                  {u.name}
                </option>
              ))}
            </select>
          )}
          {campaigns.length > 0 && (
            <select
              value={filters.campaign_id}
              onChange={(e) => setFilters({ ...filters, campaign_id: e.target.value })}
              className={`${selectClass} appearance-none`}
              aria-label="Filter by campaign"
            >
              <option value="" className="bg-surface">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} className="bg-surface">
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {filtersActive && (
            <button onClick={clearFilters} className="text-sm text-muted hover:text-fg">
              Clear
            </button>
          )}
        </div>

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
          <>
            <PipelineBoard
              deals={[...priorityDeals, ...closedDeals]}
              scores={scores}
              savingId={savingId}
              onMove={handleStageChange}
              onOpen={setSelectedDeal}
            />
            {closedDeals.length < lists.closed.total && (
              <p className="border-t border-fg/5 px-5 py-3 text-center text-xs text-subtle">
                Won and Lost show the {closedDeals.length} most recently closed of {lists.closed.total}.{' '}
                <button
                  onClick={() => loadMore('closed')}
                  disabled={loadingMore === 'closed'}
                  className="font-medium text-brand-700 hover:text-brand-800 disabled:opacity-60 dark:text-brand-300 dark:hover:text-brand-200"
                >
                  {loadingMore === 'closed' ? 'Loading…' : 'Load more'}
                </button>
              </p>
            )}
          </>
        ) : tab === 'open' ? (
          priorityDeals.length === 0 && filtersActive ? (
            noMatches
          ) : priorityDeals.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title={isTeam ? 'No open deals yet' : 'No open deals assigned to you yet'}
                description="Add your first deal or import a CSV of existing deals to get started."
              />
            </div>
          ) : (
            <>
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
                      <div className="flex flex-col">
                        <button className="text-left text-sm font-medium text-fg hover:text-fg">{d.title}</button>
                        {isTeam && ownerNames[d.owner_id] && (
                          <span className="text-xs text-subtle">{ownerNames[d.owner_id]}</span>
                        )}
                      </div>
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
              {loadMoreButton('open')}
            </>
          )
        ) : closedDeals.length === 0 && filtersActive ? (
          noMatches
        ) : closedDeals.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title="No closed deals yet"
              description="Deals you mark as won or lost will show up here."
            />
          </div>
        ) : (
          <>
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
                      {isTeam && ownerNames[d.owner_id] && ` · ${ownerNames[d.owner_id]}`}
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
            {loadMoreButton('closed')}
          </>
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
          onDeleted={() => {
            setSelectedDeal(null);
            fetchAll({ silent: true });
          }}
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
