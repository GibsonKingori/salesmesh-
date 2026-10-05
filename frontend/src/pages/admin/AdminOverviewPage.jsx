import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import StatCard from '../../components/StatCard.jsx';
import Panel from '../../components/Panel.jsx';
import AuditList from '../../components/AuditList.jsx';
import { ICONS } from '../../components/icons.jsx';
import { formatDate } from '../../lib/format.js';
import ConfirmButton from '../../components/ConfirmButton.jsx';
import { SearchIcon, StatusPill } from './AccountsPage.jsx';

const ROLE_ROWS = [
  { role: 'admin', label: 'Admins', bar: 'bg-accent-500' },
  { role: 'manager', label: 'Managers', bar: 'bg-sky-500' },
  { role: 'representative', label: 'Sales Representatives', bar: 'bg-brand-500' },
];
const ROLE_NAMES = { admin: 'Admin', manager: 'Manager', representative: 'Sales Rep' };

const linkClass = 'text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200';

// The code people enter on the Register page to join this company
function JoinCodeCard({ company, onChange }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(company.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code is on screen to copy by hand
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError('');
    try {
      onChange((await api.post('/admin/company/join-code')).data.company);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create a new code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-fg/10 bg-surface px-5 py-4 shadow-sm shadow-ink-900/5">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{company.name} · join code</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-fg">{company.joinCode}</p>
        <p className="mt-1 text-xs text-subtle">
          Share it with your team: they enter it under Register → Join a company and start as Sales Reps.
        </p>
        {error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={copy}
          className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <ConfirmButton label="New code" confirmLabel="Replace code?" disabled={busy} onConfirm={regenerate} />
      </div>
    </div>
  );
}

// Administrator home: the health of the company's account rather than sales numbers
export default function AdminOverviewPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/admin/overview')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load the admin overview'));
  }, []);

  if (error || !data) {
    return (
      <DashboardShell title="Admin overview">
        {error ? (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : (
          <div className="py-20 text-center text-sm text-muted">Loading…</div>
        )}
      </DashboardShell>
    );
  }

  const { users, records, failedLogins24h, recentActivity, company } = data;

  const findAccount = (e) => {
    e.preventDefault();
    navigate(`/admin/accounts${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`);
  };

  return (
    <DashboardShell title="Admin overview">
      <form onSubmit={findAccount} className="relative mb-6" role="search">
        <SearchIcon />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find an account by name or email, then press Enter"
          aria-label="Find an account"
          className="w-full rounded-xl border border-fg/10 bg-surface py-3 pl-9 pr-24 text-sm text-fg shadow-sm shadow-ink-900/5 placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
        />
        <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">
          Search
        </button>
      </form>

      <JoinCodeCard company={company} onChange={(next) => setData((prev) => ({ ...prev, company: next }))} />

      {users.unassignedReps > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-400/30 bg-accent-400/10 px-4 py-3 text-sm text-fg">
          <span>
            {users.unassignedReps} sales rep{users.unassignedReps === 1 ? ' has' : 's have'} no manager yet, so no manager can
            see their sales.
          </span>
          <Link to="/admin/accounts?status=unassigned" className={linkClass}>
            Assign managers →
          </Link>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Users"
          value={users.total}
          hint={users.disabled ? `${users.disabled} disabled` : 'All accounts active'}
          icon={ICONS.users}
        />
        <StatCard label="Deals" value={records.deals} hint={`${records.activities} activities logged`} icon={ICONS.pipeline} tone="sky" />
        <StatCard
          label="Contacts & campaigns"
          value={records.contacts + records.campaigns}
          hint={`${records.contacts} contacts · ${records.campaigns} campaigns`}
          icon={ICONS.database}
          tone="emerald"
        />
        <StatCard label="Failed logins" value={failedLogins24h} hint="In the last 24 hours" icon={ICONS.alert} tone="gold" />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Users by role"
          subtitle="Who can see what"
          action={
            <Link to="/admin/accounts" className={linkClass}>
              Manage accounts
            </Link>
          }
        >
          <ul className="space-y-4 px-5 py-5">
            {ROLE_ROWS.map((r) => {
              const count = users.byRole[r.role] || 0;
              const share = users.total ? (count / users.total) * 100 : 0;
              return (
                <li key={r.role}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-fg-soft">{r.label}</span>
                    <span className="font-medium tabular-nums text-fg">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-fg/5">
                    <div className={`h-2 rounded-full ${r.bar}`} style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-fg/10 px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Newest accounts</p>
            <ul className="space-y-2">
              {users.newest.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link to={`/admin/accounts/${u.id}`} className="min-w-0 truncate text-fg hover:text-brand-700 dark:hover:text-brand-300">
                    {u.name} <span className="text-xs text-subtle">· {ROLE_NAMES[u.role]}</span>
                  </Link>
                  <span className="flex items-center gap-2 whitespace-nowrap text-xs text-subtle">
                    {u.is_active === false && <StatusPill active={false} />}
                    {formatDate(u.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel
          title="Recent activity"
          subtitle="Latest entries in the audit log"
          action={
            <Link to="/admin/audit" className={linkClass}>
              View all
            </Link>
          }
        >
          <AuditList entries={recentActivity} />
        </Panel>
      </div>
    </DashboardShell>
  );
}
