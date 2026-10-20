import React, { useState } from 'react';
import { currency } from '../lib/format.js';

const plural = (n, one, many) => `${Number(n).toLocaleString('en-KE')} ${n === 1 ? one : many}`;

// "Are you sure?" panel shown before an import is deleted, spelling out what will be lost.
// Stays on screen until the user picks Cancel or Delete (no browser confirm() dialog).
export default function DeleteImportWarning({ fileName, deals, contacts, value, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alertdialog" aria-label="Delete this import?" className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm">
      <p className="font-semibold text-red-800 dark:text-red-200">Are you sure you want to delete this import?</p>
      <p className="mt-1 text-red-800/90 dark:text-red-200/90">
        {fileName ? `“${fileName}”: ` : ''}
        {plural(deals, 'deal', 'deals')}
        {value != null ? ` worth ${currency(value)}` : ''} will be permanently deleted
        {contacts ? `, along with up to ${plural(contacts, 'contact', 'contacts')} it added` : ''}.
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-800/80 dark:text-red-200/80">
        <li>Any changes and activity logged on these deals since the import are lost too.</li>
        <li>Dashboards, forecasts and reports will no longer include them.</li>
        <li>This can't be undone. To get the deals back you would have to import the file again.</li>
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          autoFocus
          className="rounded-lg border border-fg/10 bg-surface px-3 py-1.5 text-xs font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-500 disabled:opacity-60"
        >
          {busy ? 'Deleting…' : `Yes, delete ${plural(deals, 'deal', 'deals')}`}
        </button>
      </div>
    </div>
  );
}
