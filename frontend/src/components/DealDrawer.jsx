import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import StageSelect from './StageSelect.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n || 0);

const inputClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';

const LOG_TYPES = [
  { id: 'call', label: 'Call' },
  { id: 'email', label: 'Email' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'note', label: 'Note' },
];

const TYPE_STYLES = {
  call: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-400/20',
  email: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-400/20',
  meeting: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-400/20',
  note: 'bg-ink-500/10 text-fg-soft ring-ink-400/20',
  stage_change: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-400/20',
};

const TYPE_LABELS = { call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note', stage_change: 'Stage' };

const formatWhen = (iso) =>
  new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

const Label = ({ children }) => (
  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">{children}</p>
);

// Side panel for one deal: edit stage/close date, link a contact, and read/write its activity log.
// onChanged is called after any deal edit so the dashboard can re-rank; onDeleted after a delete.
export default function DealDrawer({ deal: initialDeal, onClose, onChanged, onDeleted }) {
  const { user } = useAuth();
  const [deal, setDeal] = useState(initialDeal);
  const [activities, setActivities] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [logType, setLogType] = useState('call');
  const [logNotes, setLogNotes] = useState('');
  const [logging, setLogging] = useState(false);

  const [addingContact, setAddingContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', company: '', phone: '', email: '' });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchActivities = () =>
    api
      .get('/activities', { params: { deal_id: deal.id } })
      .then((res) => setActivities(res.data.activities))
      .catch((err) => setError(err.response?.data?.error || 'Could not load the activity log'))
      .finally(() => setLoadingLog(false));

  useEffect(() => {
    fetchActivities();
    api.get('/contacts').then((res) => setContacts(res.data.contacts)).catch(() => {});
  }, [deal.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const updateDeal = async (fields) => {
    setError('');
    setSaving(true);
    try {
      const { data } = await api.patch(`/deals/${deal.id}`, fields);
      setDeal(data.deal);
      onChanged();
      // A stage move writes a stage_change entry server-side
      if ('stage' in fields) fetchActivities();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the change');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleLog = async (e) => {
    e.preventDefault();
    setError('');
    setLogging(true);
    try {
      const { data } = await api.post('/activities', { deal_id: deal.id, type: logType, notes: logNotes });
      setActivities((prev) => [data.activity, ...prev]);
      setLogNotes('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not log the activity');
    } finally {
      setLogging(false);
    }
  };

  const handleDeleteActivity = async (id) => {
    setError('');
    try {
      await api.delete(`/activities/${id}`);
      setActivities((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove the entry');
    }
  };

  const handleCreateContact = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/contacts', newContact);
      setContacts((prev) => [data.contact, ...prev]);
      if (await updateDeal({ contact_id: data.contact.id })) {
        setAddingContact(false);
        setNewContact({ name: '', company: '', phone: '', email: '' });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the contact');
    }
  };

  const handleDeleteDeal = async () => {
    setError('');
    setDeleting(true);
    try {
      await api.delete(`/deals/${deal.id}`);
      onDeleted();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete the deal');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const contact = contacts.find((c) => c.id === deal.contact_id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-canvas/40 backdrop-blur-sm" onClick={onClose} />

      <aside
        role="dialog"
        aria-label={deal.title}
        className="relative flex h-full w-full max-w-md animate-slide-in-right flex-col border-l border-fg/10 bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-fg/10 px-6 py-5">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-semibold text-fg">{deal.title}</h3>
            <p className="mt-0.5 text-sm text-muted">{currency(deal.value)}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fg/10 hover:text-fg"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {error && (
            <div className="flex items-center justify-between rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-xs text-red-700 dark:text-red-300/70 hover:text-red-800 dark:hover:text-red-200">
                Dismiss
              </button>
            </div>
          )}

          <section className="grid grid-cols-2 gap-4">
            <div>
              <Label>Stage</Label>
              <StageSelect stage={deal.stage} disabled={saving} onChange={(stage) => updateDeal({ stage })} />
            </div>
            <div>
              <Label>Expected close</Label>
              <input
                type="date"
                value={deal.expected_close_date || ''}
                disabled={saving}
                onChange={(e) => updateDeal({ expected_close_date: e.target.value || null })}
                className={`${inputClass} py-1 dark:[color-scheme:dark]`}
              />
            </div>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Contact</Label>
              {!addingContact && (
                <button
                  onClick={() => setAddingContact(true)}
                  className="mb-1.5 text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
                >
                  + New contact
                </button>
              )}
            </div>

            {addingContact ? (
              <form onSubmit={handleCreateContact} className="space-y-2 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
                <input
                  placeholder="Name"
                  required
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  className={inputClass}
                />
                <input
                  placeholder="Company (optional)"
                  value={newContact.company}
                  onChange={(e) => setNewContact({ ...newContact, company: e.target.value })}
                  className={inputClass}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder="Phone"
                    type="tel"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    placeholder="Email"
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAddingContact(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-60"
                  >
                    Save & link
                  </button>
                </div>
              </form>
            ) : (
              <>
                <select
                  value={deal.contact_id || ''}
                  disabled={saving}
                  onChange={(e) => updateDeal({ contact_id: e.target.value || null })}
                  className={`${inputClass} appearance-none`}
                >
                  <option value="" className="bg-surface">
                    {contacts.length ? 'No contact linked' : 'No contacts yet — add one'}
                  </option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id} className="bg-surface">
                      {c.name}
                      {c.company ? ` — ${c.company}` : ''}
                    </option>
                  ))}
                </select>
                {contact && (contact.phone || contact.email) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="text-muted hover:text-fg">
                        {contact.phone}
                      </a>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="text-muted hover:text-fg">
                        {contact.email}
                      </a>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <Label>Log activity</Label>
            <form onSubmit={handleLog} className="space-y-2">
              <div className="flex gap-1.5">
                {LOG_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLogType(t.id)}
                    aria-pressed={logType === t.id}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                      logType === t.id ? TYPE_STYLES[t.id] : 'text-muted ring-fg/10 hover:text-fg'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                placeholder="What happened? e.g. Spoke to procurement, they want a revised quote by Friday"
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                className={`${inputClass} resize-none`}
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={logging}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-60"
                >
                  {logging ? 'Logging…' : 'Log activity'}
                </button>
              </div>
            </form>
          </section>

          <section>
            <Label>History</Label>
            {loadingLog ? (
              <p className="py-4 text-sm text-subtle">Loading…</p>
            ) : activities.length === 0 ? (
              <p className="py-4 text-sm text-subtle">Nothing logged yet.</p>
            ) : (
              <ol className="space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="group rounded-xl border border-fg/5 bg-fg/[0.02] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TYPE_STYLES[a.type]}`}
                        >
                          {TYPE_LABELS[a.type] || a.type}
                        </span>
                        <span className="text-xs text-subtle">{formatWhen(a.created_at)}</span>
                      </div>
                      {a.type !== 'stage_change' && a.user_id === user?.id && (
                        <button
                          onClick={() => handleDeleteActivity(a.id)}
                          className="text-xs text-faint opacity-0 transition-opacity hover:text-red-700 dark:hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                          aria-label="Remove entry"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {a.notes && (
                      <p className={`mt-1.5 whitespace-pre-wrap text-sm ${a.type === 'stage_change' ? 'capitalize text-muted' : 'text-fg'}`}>
                        {a.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="border-t border-fg/10 pt-4">
            {confirmDelete ? (
              <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm">
                <p className="text-red-700 dark:text-red-300">
                  Delete “{deal.title}” and its whole activity history? This can't be undone.
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteDeal}
                    disabled={deleting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
                  >
                    {deleting ? 'Deleting…' : 'Delete deal'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
              >
                Delete deal
              </button>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
