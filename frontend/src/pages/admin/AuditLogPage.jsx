import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import AuditList from '../../components/AuditList.jsx';
import Panel from '../../components/Panel.jsx';
import { AUDIT_CATEGORIES, dayRange, describeAudit, toDateInput } from '../../lib/audit.js';
import { downloadCsv } from '../../lib/csv.js';
import { SearchIcon } from './AccountsPage.jsx';

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 1000;

const pageButton =
  'rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-40';
const inputClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';
const chip = (active) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'}`;

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateInput(d);
};

// Shortcuts: each sets a start date and a number of days
const QUICK_RANGES = [
  { label: 'Today', date: () => daysAgo(0), days: 1 },
  { label: 'Yesterday', date: () => daysAgo(1), days: 1 },
  { label: 'Last 7 days', date: () => daysAgo(6), days: 7 },
];

// Filters are kept in the URL (?date=2026-10-04&days=1&q=&category=&user=&name=) so links
// from an account page open the right view and the back button works
export default function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || '';
  const days = Number(params.get('days')) || 1;
  const category = params.get('category') || '';
  const q = params.get('q') || '';
  const userId = params.get('user') || '';
  const userName = params.get('name') || '';

  const [search, setSearch] = useState(q);
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, String(v)) : next.delete(k)));
    setParams(next, { replace: true });
    setOffset(0);
  };

  // Type to search; the request waits until typing pauses
  useEffect(() => {
    if (search === q) return undefined;
    const t = setTimeout(() => update({ q: search.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filters = () => ({
    category: category || undefined,
    q: q || undefined,
    user_id: userId || undefined,
    ...(date ? dayRange(date, days) : {}),
  });

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .get('/admin/audit', { params: { ...filters(), limit: PAGE_SIZE, offset } })
      .then((res) => {
        setEntries(res.data.entries);
        setTotal(res.data.total);
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load the audit log'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, days, category, q, userId, offset]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = [];
      for (let from = 0; from < Math.min(total, EXPORT_LIMIT); from += 100) {
        const res = await api.get('/admin/audit', { params: { ...filters(), limit: 100, offset: from } });
        rows.push(...res.data.entries);
      }
      downloadCsv(
        `salesmesh-audit-${date || 'all'}.csv`,
        ['When', 'Who', 'What', 'Action code'],
        rows.map((e) => [new Date(e.created_at).toLocaleString('en-KE'), e.user_name || '', describeAudit(e), e.action])
      );
    } catch (err) {
      setError(err.response?.data?.error || 'Could not export the audit log');
    } finally {
      setExporting(false);
    }
  };

  const activeQuick = QUICK_RANGES.find((r) => r.date() === date && r.days === days);
  const anyFilter = date || category || q || userId;
  const rangeText = !date
    ? 'all time'
    : days === 1
      ? new Date(`${date}T00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${days} days from ${new Date(`${date}T00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`;

  return (
    <DashboardShell title="Audit log">
      <Panel
        title="Audit log"
        subtitle="Every sign-in, password reset, account change and change to sales data"
        action={
          <button onClick={exportCsv} disabled={exporting || total === 0} className={pageButton}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      >
        <div className="space-y-3 border-b border-fg/10 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-fg-soft">
              Day
              <input
                type="date"
                value={date}
                max={toDateInput(new Date())}
                onChange={(e) => update({ date: e.target.value, days: '' })}
                className={`${inputClass} dark:[color-scheme:dark]`}
                aria-label="Show entries from this day"
              />
            </label>
            {QUICK_RANGES.map((r) => (
              <button key={r.label} onClick={() => update({ date: r.date(), days: r.days === 1 ? '' : r.days })} aria-pressed={activeQuick === r} className={chip(activeQuick === r)}>
                {r.label}
              </button>
            ))}
            <button onClick={() => update({ date: '', days: '' })} aria-pressed={!date} className={chip(!date)}>
              Any time
            </button>
          </div>

          <div className="relative">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by who did it"
              aria-label="Search by name"
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {AUDIT_CATEGORIES.map((c) => (
              <button key={c.value} onClick={() => update({ category: c.value })} aria-pressed={category === c.value} className={chip(category === c.value)}>
                {c.label}
              </button>
            ))}
          </div>

          {userId && (
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-800 dark:text-brand-200">
              Only {userName || 'one person'}
              <button onClick={() => update({ user: '', name: '' })} aria-label="Show everyone" className="text-base leading-none">
                ×
              </button>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-xs text-subtle">
          <span>
            {loading ? 'Loading…' : `${total} entr${total === 1 ? 'y' : 'ies'}`} · {rangeText}
          </span>
          {anyFilter && (
            <button
              onClick={() => {
                setSearch('');
                setParams({}, { replace: true });
                setOffset(0);
              }}
              className="font-medium text-brand-700 dark:text-brand-300"
            >
              Clear filters
            </button>
          )}
        </div>

        {error && <p className="px-5 py-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {loading ? (
          <p className="border-t border-fg/10 px-5 py-10 text-center text-sm text-muted">Loading…</p>
        ) : (
          !error && (
            <div className="border-t border-fg/10">
              <AuditList entries={entries} />
            </div>
          )
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-fg/10 px-5 py-3 text-sm text-muted">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button className={pageButton} disabled={offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>
                Newer
              </button>
              <button className={pageButton} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Older
              </button>
            </div>
          </div>
        )}
      </Panel>
    </DashboardShell>
  );
}
