import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import Modal from './Modal.jsx';
import DeleteImportWarning from './DeleteImportWarning.jsx';
import { currency, formatDate } from '../lib/format.js';

const when = (iso) => new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
const count = (n, one, many) => `${Number(n).toLocaleString('en-KE')} ${n === 1 ? one : many}`;

// What the list calls an import: its name, or (for imports saved before names were recorded)
// a description built from its size and date
export const importLabel = (imp) => imp.file_name || `Import of ${count(imp.deal_count, 'deal', 'deals')} on ${formatDate(imp.created_at)}`;

const smallButton =
  'whitespace-nowrap rounded-lg border border-fg/10 px-2.5 py-1 text-xs font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg';

// Files imported on the Deals page; deleting one removes the deals it created and the contacts
// it added that no other deal uses (DELETE /api/deals/imports/:id). Each entry shows enough of
// what's inside (example deals, their dates, stages) to recognise it, and "View deals" filters
// the Deals page to it.
export default function ImportHistoryModal({ onClose, onDeleted, onView }) {
  const [imports, setImports] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, name }

  const load = () =>
    api
      .get('/deals/imports')
      .then((res) => setImports(res.data.imports))
      .catch((err) => setError(err.response?.data?.error || 'Could not load your imports'));

  useEffect(() => {
    load();
  }, []);

  const remove = async (imp) => {
    setError('');
    setNotice('');
    try {
      const { data } = await api.delete(`/deals/imports/${imp.id}`);
      const contacts = data.deletedContacts ? ` and ${count(data.deletedContacts, 'contact', 'contacts')}` : '';
      const kept = data.remainingDeals
        ? ` ${data.remainingDeals} deal${data.remainingDeals === 1 ? ' belongs' : 's belong'} to someone outside your team and ${data.remainingDeals === 1 ? 'was' : 'were'} kept.`
        : '';
      setConfirmingId(null);
      setNotice(`Deleted ${count(data.deletedDeals, 'deal', 'deals')}${contacts} from “${importLabel(imp)}”.${kept}`);
      onDeleted();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete that import');
    }
  };

  const saveName = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.patch(`/deals/imports/${renaming.id}`, { name: renaming.name });
      setRenaming(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not rename that import');
    }
  };

  return (
    <Modal title="Past imports" onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{notice}</div>
      )}
      <p className="mb-3 text-xs text-subtle">
        Not sure which import is which? Use <span className="font-medium text-muted">View deals</span> to see exactly what an import added, and{' '}
        <span className="font-medium text-muted">Rename</span> to give it a name you'll recognise.
      </p>
      {imports === null ? (
        <p className="py-6 text-center text-sm text-muted">Loading imports…</p>
      ) : imports.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No imports yet. Files you import on this page will be listed here.</p>
      ) : (
        <ul className="divide-y divide-fg/5 rounded-lg border border-fg/10">
          {imports.map((imp) => (
            <li key={imp.id} className="px-3 py-3">
              {renaming?.id === imp.id ? (
                <form onSubmit={saveName} className="flex gap-2">
                  <input
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    maxLength={200}
                    placeholder="e.g. Maven CRM test data"
                    aria-label="Import name"
                    className="min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1 text-sm text-fg outline-none focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button type="submit" disabled={!renaming.name.trim()} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className={smallButton}>
                    Cancel
                  </button>
                </form>
              ) : (
                <p className="break-words text-sm font-medium text-fg">
                  {importLabel(imp)}
                  {!imp.file_name && <span className="ml-1.5 text-xs font-normal text-faint">(no name saved)</span>}
                </p>
              )}
              <p className="mt-0.5 text-xs text-subtle">
                Imported {when(imp.created_at)}
                {imp.user_name && ` by ${imp.user_name}`}
              </p>
              <p className="mt-1 text-xs text-muted">
                {count(imp.deal_count, 'deal', 'deals')} · {currency(imp.total_value)}
                {imp.stages && ` · ${imp.stages.open.toLocaleString('en-KE')} open, ${imp.stages.won.toLocaleString('en-KE')} won, ${imp.stages.lost.toLocaleString('en-KE')} lost`}
                {imp.contact_count ? ` · ${count(imp.contact_count, 'new contact', 'new contacts')}` : ''}
              </p>
              {imp.first_deal_at && (
                <p className="text-xs text-muted">
                  Deal dates {formatDate(imp.first_deal_at)}
                  {formatDate(imp.last_deal_at) !== formatDate(imp.first_deal_at) && ` – ${formatDate(imp.last_deal_at)}`}
                </p>
              )}
              {imp.sample_titles?.length > 0 && (
                <p className="mt-1 truncate text-xs italic text-subtle" title={imp.sample_titles.join(', ')}>
                  e.g. {imp.sample_titles.map((t) => `“${t}”`).join(', ')}
                </p>
              )}

              {confirmingId === imp.id ? (
                <div className="mt-2">
                  <DeleteImportWarning
                    fileName={importLabel(imp)}
                    deals={imp.deal_count}
                    contacts={imp.contact_count}
                    value={imp.total_value}
                    onConfirm={() => remove(imp)}
                    onCancel={() => setConfirmingId(null)}
                  />
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => onView(imp)} className={smallButton}>
                    View deals
                  </button>
                  <button type="button" onClick={() => setRenaming({ id: imp.id, name: imp.file_name || '' })} className={smallButton}>
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(imp.id)}
                    className="whitespace-nowrap rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
