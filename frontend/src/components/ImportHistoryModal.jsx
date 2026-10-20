import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import Modal from './Modal.jsx';
import DeleteImportWarning from './DeleteImportWarning.jsx';
import { currency } from '../lib/format.js';

const when = (iso) => new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

// Files imported on the Deals page; deleting one removes the deals it created and the contacts
// it added that no other deal uses (DELETE /api/deals/imports/:id)
export default function ImportHistoryModal({ onClose, onDeleted }) {
  const [imports, setImports] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);

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
      const contacts = data.deletedContacts ? ` and ${data.deletedContacts} contact${data.deletedContacts === 1 ? '' : 's'}` : '';
      const kept = data.remainingDeals
        ? ` ${data.remainingDeals} deal${data.remainingDeals === 1 ? ' belongs' : 's belong'} to someone outside your team and ${data.remainingDeals === 1 ? 'was' : 'were'} kept.`
        : '';
      setConfirmingId(null);
      setNotice(`Deleted ${data.deletedDeals} deal${data.deletedDeals === 1 ? '' : 's'}${contacts} from “${imp.file_name || 'that import'}”.${kept}`);
      onDeleted();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete that import');
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
        Deleting an import removes every deal it created, including any changes made to them since, and the contacts it added that no other deal uses.
      </p>
      {imports === null ? (
        <p className="py-6 text-center text-sm text-muted">Loading imports…</p>
      ) : imports.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No imports yet. Files you import on this page will be listed here.</p>
      ) : (
        <ul className="divide-y divide-fg/5 rounded-lg border border-fg/10">
          {imports.map((imp) => (
            <li key={imp.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg" title={imp.file_name || ''}>
                    {imp.file_name || 'File name not recorded'}
                  </p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {when(imp.created_at)}
                    {imp.user_name && ` · ${imp.user_name}`}
                  </p>
                  <p className="text-xs text-muted">
                    {imp.deal_count} deal{imp.deal_count === 1 ? '' : 's'} · {currency(imp.total_value)}
                    {imp.contact_count ? ` · ${imp.contact_count} new contact${imp.contact_count === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                {confirmingId !== imp.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(imp.id)}
                    className="whitespace-nowrap rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
              {confirmingId === imp.id && (
                <div className="mt-2">
                  <DeleteImportWarning
                    fileName={imp.file_name}
                    deals={imp.deal_count}
                    contacts={imp.contact_count}
                    value={imp.total_value}
                    onConfirm={() => remove(imp)}
                    onCancel={() => setConfirmingId(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
