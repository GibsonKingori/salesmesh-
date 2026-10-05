import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import Panel from '../../components/Panel.jsx';
import ConfirmButton from '../../components/ConfirmButton.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_NAMES } from '../../lib/audit.js';
import { formatDate } from '../../lib/format.js';

const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'admin', label: 'Admins' },
  { value: 'manager', label: 'Managers' },
  { value: 'representative', label: 'Sales Reps' },
];
const STATUS_FILTERS = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'unassigned', label: 'Reps without a manager' },
];

// What each role can do, following the Chapter 4 use case diagram
const PERMISSIONS = [
  { label: 'View dashboard & KPIs', rep: 'Own deals', manager: 'Their team', admin: '—' },
  { label: 'Manage deals & log activities', rep: 'Own deals', manager: 'Their team’s deals', admin: 'Any account' },
  { label: 'Pipeline analytics', rep: 'Own pipeline', manager: 'Their team', admin: '—' },
  { label: 'Campaign analytics', rep: 'Own results', manager: 'Budget, CPA, ROI (team’s deals)', admin: 'Any account' },
  { label: 'Export reports', rep: '—', manager: 'Yes', admin: '—' },
  { label: 'Manage accounts, roles, permissions & teams', rep: '—', manager: '—', admin: 'Yes' },
  { label: 'System configuration', rep: '—', manager: 'View targets', admin: 'Yes' },
  { label: 'Audit log', rep: '—', manager: '—', admin: 'Yes' },
];

const inputClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 py-2 pl-9 pr-3 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';
const selectClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-sm text-fg outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60';
const chip = (active) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'}`;

export function StatusPill({ active }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {active ? 'Active' : 'Disabled'}
    </span>
  );
}

export const SearchIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint">
    <circle cx="9" cy="9" r="6" />
    <path strokeLinecap="round" d="M14 14l4 4" />
  </svg>
);

// Admin "Manage Roles & Permissions": find any account, change its role, enable or disable it,
// or open it to look after its deals and campaigns.
export default function AccountsPage() {
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const roleFilter = params.get('role') || '';
  const statusFilter = params.get('status') || '';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api
      .get('/users')
      .then((res) => setUsers(res.data.users))
      .catch((err) => setError(err.response?.data?.error || 'Could not load accounts'))
      .finally(() => setLoading(false));
  }, []);

  // Filters live in the URL so a search can be bookmarked or opened from the Overview
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter ||
          (statusFilter === 'unassigned' ? u.role === 'representative' && !u.manager_id : (statusFilter === 'active') === (u.is_active !== false)))
    );
  }, [users, query, roleFilter, statusFilter]);

  const managers = useMemo(() => users.filter((u) => u.role === 'manager'), [users]);
  const teamSize = useMemo(() => {
    const counts = {};
    users.forEach((u) => u.manager_id && (counts[u.manager_id] = (counts[u.manager_id] || 0) + 1));
    return counts;
  }, [users]);

  // A role change can also leave a demoted manager's reps unassigned; the API returns them too
  const replaceUsers = (updated) => {
    const byId = new Map(updated.map((u) => [u.id, u]));
    setUsers((prev) => prev.map((u) => byId.get(u.id) || u));
  };

  const run = async (member, action, success) => {
    setError('');
    setNotice('');
    setSavingId(member.id);
    try {
      const { data } = await action();
      replaceUsers([data.user, ...(data.unassigned || [])]);
      setNotice(typeof success === 'function' ? success(data) : success);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the change');
    } finally {
      setSavingId(null);
    }
  };

  const changeRole = (member, role) =>
    run(member, () => api.patch(`/users/${member.id}/role`, { role }), (data) => {
      const left = data.unassigned?.length;
      return `${member.name} is now ${ROLE_NAMES[role]}.${left ? ` ${left} of their rep${left === 1 ? '' : 's'} now need${left === 1 ? 's' : ''} a new manager.` : ''}`;
    });
  const changeManager = (member, managerId) =>
    run(
      member,
      () => api.patch(`/users/${member.id}/manager`, { manager_id: managerId || null }),
      managerId ? `${member.name} is now in ${managers.find((m) => m.id === managerId)?.name}’s team.` : `${member.name} has no manager now.`
    );
  const setActive = (member, active) =>
    run(
      member,
      () => api.patch(`/users/${member.id}/status`, { active }),
      active ? `${member.name} can log in again.` : `${member.name} is disabled and has been signed out.`
    );

  const filtered = query || roleFilter || statusFilter;

  return (
    <DashboardShell title="Accounts">
      <div className="space-y-4">
        <Panel title="Accounts" subtitle="Search for anyone, change their role or manager, or disable their account">
          <div className="space-y-3 border-b border-fg/10 px-5 py-4">
            <div className="relative">
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={(e) => setParam('q', e.target.value)}
                placeholder="Search by name or email"
                aria-label="Search accounts"
                className={inputClass}
                autoFocus
              />
            </div>
            <div className="no-scrollbar flex flex-wrap items-center gap-1 overflow-x-auto">
              {ROLE_FILTERS.map((f) => (
                <button key={f.value} onClick={() => setParam('role', f.value)} aria-pressed={roleFilter === f.value} className={chip(roleFilter === f.value)}>
                  {f.label}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-fg/10" />
              {STATUS_FILTERS.map((f) => (
                <button key={f.value} onClick={() => setParam('status', f.value)} aria-pressed={statusFilter === f.value} className={chip(statusFilter === f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {(error || notice) && (
            <div className="border-b border-fg/10 px-5 py-3 text-sm">
              {error && <span className="text-red-700 dark:text-red-300">{error}</span>}
              {notice && <span className="text-emerald-700 dark:text-emerald-300">{notice}</span>}
            </div>
          )}

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              No accounts match.{' '}
              {filtered && (
                <button onClick={() => setParams({}, { replace: true })} className="font-medium text-brand-700 dark:text-brand-300">
                  Clear filters
                </button>
              )}
            </p>
          ) : (
            <ul className="divide-y divide-fg/5">
              {visible.map((member) => {
                const isSelf = member.id === me.id;
                const active = member.is_active !== false;
                const busy = savingId === member.id;
                return (
                  <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                    <Link to={`/admin/accounts/${member.id}`} className="group min-w-0 flex-1 basis-48">
                      <p className="truncate text-sm font-medium text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300">
                        {member.name} {isSelf && <span className="text-xs font-normal text-subtle">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-subtle">
                        {member.email} · joined {formatDate(member.created_at)}
                        {member.role === 'manager' && ` · ${teamSize[member.id] || 0} rep${teamSize[member.id] === 1 ? '' : 's'}`}
                      </p>
                    </Link>
                    <StatusPill active={active} />
                    {member.role === 'representative' && (
                      <select
                        aria-label={`Manager for ${member.name}`}
                        value={member.manager_id || ''}
                        disabled={busy}
                        onChange={(e) => changeManager(member, e.target.value)}
                        className={`${selectClass} ${member.manager_id ? '' : 'text-accent-600 dark:text-accent-300'}`}
                      >
                        <option value="" className="bg-surface">
                          {managers.length ? 'No manager' : 'No managers yet'}
                        </option>
                        {managers.map((m) => (
                          <option key={m.id} value={m.id} className="bg-surface">
                            Manager: {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      disabled={isSelf || busy}
                      title={isSelf ? 'You cannot change your own role' : undefined}
                      onChange={(e) => changeRole(member, e.target.value)}
                      className={selectClass}
                    >
                      {Object.entries(ROLE_NAMES).map(([value, label]) => (
                        <option key={value} value={value} className="bg-surface">
                          {label}
                        </option>
                      ))}
                    </select>
                    {!isSelf &&
                      (active ? (
                        <ConfirmButton label="Disable" confirmLabel="Disable?" disabled={busy} onConfirm={() => setActive(member, false)} />
                      ) : (
                        <button
                          onClick={() => setActive(member, true)}
                          disabled={busy}
                          className="rounded-lg border border-emerald-400/40 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
                        >
                          Enable
                        </button>
                      ))}
                    <Link
                      to={`/admin/accounts/${member.id}`}
                      className="rounded-lg border border-fg/10 px-2.5 py-1 text-xs font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg"
                    >
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && users.length > 0 && (
            <p className="border-t border-fg/10 px-5 py-3 text-xs text-subtle">
              Showing {visible.length} of {users.length} accounts. Role, manager and status changes apply immediately. A manager
              sees only the reps assigned to them.
            </p>
          )}
        </Panel>

        <details className="group rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
          <summary className="cursor-pointer list-none px-5 py-4 font-display font-semibold text-fg">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
            What each role can do
          </summary>
          <div className="overflow-x-auto border-t border-fg/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fg/10 text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-5 py-3 font-medium">Feature</th>
                  <th className="px-3 py-3 font-medium">Sales Rep</th>
                  <th className="px-3 py-3 font-medium">Manager</th>
                  <th className="px-3 py-3 font-medium">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fg/5">
                {PERMISSIONS.map((p) => (
                  <tr key={p.label}>
                    <td className="px-5 py-2.5 text-fg-soft">{p.label}</td>
                    {[p.rep, p.manager, p.admin].map((v, i) => (
                      <td key={i} className={`px-3 py-2.5 ${v === '—' ? 'text-faint' : 'text-fg'}`}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </DashboardShell>
  );
}
