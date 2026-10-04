import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import DashboardShell from '../components/DashboardShell.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ContactModal from '../components/ContactModal.jsx';
import { currency } from '../lib/format.js';

const SEARCH_FIELDS = ['name', 'company', 'email', 'phone'];

// Contacts list for both roles; the API scopes it (reps: own contacts, managers: whole team)
export default function ContactsPage({ scope }) {
  const isTeam = scope === 'team';
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // null = closed, {} = adding, { contact } = editing
  const [modal, setModal] = useState(null);

  const fetchAll = ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    return Promise.all([api.get('/contacts'), api.get('/deals')])
      .then(([c, d]) => {
        setContacts(c.data.contacts);
        setDeals(d.data.deals);
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load contacts'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Deal count and open pipeline value per contact
  const dealStats = useMemo(() => {
    const stats = {};
    for (const d of deals) {
      if (!d.contact_id) continue;
      const s = (stats[d.contact_id] ||= { count: 0, openValue: 0 });
      s.count += 1;
      if (!['won', 'lost'].includes(d.stage)) s.openValue += Number(d.value) || 0;
    }
    return stats;
  }, [deals]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? contacts.filter((c) => SEARCH_FIELDS.some((f) => c[f]?.toLowerCase().includes(term)))
    : contacts;

  return (
    <DashboardShell title={isTeam ? 'Team contacts' : 'My contacts'}>
      <div className="rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fg/10 px-5 py-4">
          <div>
            <h2 className="font-display font-semibold text-fg">{isTeam ? 'Team contacts' : 'Your contacts'}</h2>
            <p className="mt-0.5 text-xs text-subtle">The people behind your deals — newest first</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search name, company, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
              aria-label="Search contacts"
            />
            <button
              onClick={() => setModal({})}
              className="whitespace-nowrap rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
            >
              + Add contact
            </button>
          </div>
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
          <div className="px-5 py-10 text-center text-sm text-muted">Loading contacts…</div>
        ) : contacts.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title="No contacts yet"
              description="Add the people you sell to, then link them to deals from the deal panel."
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No contacts match “{search.trim()}”</div>
        ) : (
          <ul className="divide-y divide-fg/5">
            {visible.map((c) => {
              const stats = dealStats[c.id];
              return (
                <li
                  key={c.id}
                  onClick={() => setModal({ contact: c })}
                  className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-fg/[0.03]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-400/30 dark:text-brand-300">
                      {c.name?.[0]?.toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                      <p className="truncate text-xs text-subtle">{c.company || 'No company'}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-5 text-sm" onClick={(e) => e.stopPropagation()}>
                    <div className="hidden flex-col items-end text-xs md:flex">
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="text-muted hover:text-fg">
                          {c.phone}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="text-muted hover:text-fg">
                          {c.email}
                        </a>
                      )}
                    </div>
                    <div className="w-28 text-right">
                      <p className="text-fg-soft">
                        {stats ? `${stats.count} deal${stats.count === 1 ? '' : 's'}` : 'No deals'}
                      </p>
                      {stats?.openValue > 0 && (
                        <p className="text-xs text-subtle">{currency(stats.openValue)} open</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {modal && (
        <ContactModal
          contact={modal.contact}
          linkedDeals={modal.contact ? dealStats[modal.contact.id]?.count || 0 : 0}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            fetchAll({ silent: true });
          }}
        />
      )}
    </DashboardShell>
  );
}
