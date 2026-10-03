import React, { useEffect, useState } from 'react';
import api from '../api/client.js';

const ROLES = [
  { value: 'representative', label: 'Sales Representative' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

const selectClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60';

// Admin-only: everyone signs up as a representative, and an admin promotes them here.
export default function TeamRolesPanel({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api
      .get('/users')
      .then((res) => setUsers(res.data.users))
      .catch((err) => setError(err.response?.data?.error || 'Could not load team'))
      .finally(() => setLoading(false));
  }, []);

  const changeRole = async (member, role) => {
    setError('');
    setNotice('');
    setSavingId(member.id);
    try {
      const { data } = await api.patch(`/users/${member.id}/role`, { role });
      setUsers((prev) => prev.map((u) => (u.id === member.id ? data.user : u)));
      setNotice(`${member.name} is now ${ROLES.find((r) => r.value === role).label}. It applies from their next login.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change role');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="max-w-2xl rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
      <div className="border-b border-fg/10 px-5 py-4">
        <h2 className="font-display font-semibold text-fg">Team &amp; roles</h2>
        <p className="mt-0.5 text-xs text-subtle">
          New sign-ups start as Sales Representatives. Promote people to Manager or Admin here.
        </p>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted">Loading…</div>
      ) : (
        <ul className="divide-y divide-fg/5">
          {users.map((member) => {
            const isSelf = member.id === currentUserId;
            return (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {member.name} {isSelf && <span className="text-xs font-normal text-subtle">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-subtle">{member.email}</p>
                </div>
                <select
                  aria-label={`Role for ${member.name}`}
                  value={member.role}
                  disabled={isSelf || savingId === member.id}
                  title={isSelf ? 'You cannot change your own role' : undefined}
                  onChange={(e) => changeRole(member, e.target.value)}
                  className={selectClass}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value} className="bg-surface">
                      {r.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}

      {(error || notice) && (
        <div className="border-t border-fg/10 px-5 py-3 text-sm">
          {error && <span className="text-red-700 dark:text-red-300">{error}</span>}
          {notice && <span className="text-emerald-700 dark:text-emerald-300">{notice}</span>}
        </div>
      )}
    </section>
  );
}
