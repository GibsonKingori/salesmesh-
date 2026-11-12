import React, { useState } from 'react';
import { currency } from '../lib/format.js';
import { ICONS } from './icons.jsx';

const plural = (n, one, many) => `${Number(n).toLocaleString('en-KE')} ${n === 1 ? one : many}`;

// High-emphasis confirmation panel shown before an import is deleted.
// Prominently identifies the specific import, itemizes what will be permanently deleted,
// and requires explicit checkbox confirmation before enabling the delete button.
export default function DeleteImportWarning({ fileName, deals, contacts, value, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const confirm = async () => {
    if (!confirmed) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-label="Delete this import?"
      className="mt-3 rounded-xl border-2 border-red-500/60 bg-red-500/10 p-4 text-sm shadow-md dark:bg-red-950/30"
    >
      <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
        <span className="text-red-600 dark:text-red-400">{ICONS.alert}</span>
        <p className="font-bold text-base tracking-tight">Confirm Permanent Deletion</p>
      </div>

      {/* Target import emphasis card */}
      <div className="mt-3 rounded-lg border border-red-500/30 bg-surface/90 p-3 shadow-inner dark:bg-surface-elevated/90">
        <div className="text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
          Target Import to Delete:
        </div>
        <div className="mt-1 text-base font-extrabold text-fg break-words">
          “{fileName || 'Selected Import'}”
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center rounded-md bg-red-500/15 px-2.5 py-1 font-semibold text-red-800 dark:text-red-200">
            💼 {plural(deals, 'deal', 'deals')}
          </span>
          {value != null && (
            <span className="inline-flex items-center rounded-md bg-red-500/15 px-2.5 py-1 font-semibold text-red-800 dark:text-red-200">
              💰 {currency(value)}
            </span>
          )}
          {contacts ? (
            <span className="inline-flex items-center rounded-md bg-red-500/15 px-2.5 py-1 font-semibold text-red-800 dark:text-red-200">
              👥 {plural(contacts, 'contact', 'contacts')}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-xs font-medium text-red-800/90 dark:text-red-200/90">
        Deleting this import will permanently erase all associated deals and activities from your pipeline, forecasts, and dashboards.
      </p>

      {/* Confirmation safeguard checkbox */}
      <label className="mt-3 flex items-start gap-2.5 cursor-pointer rounded-lg border border-red-400/40 bg-red-500/10 p-2.5 text-xs text-red-900 dark:text-red-100 transition-colors hover:bg-red-500/15">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-red-400 text-red-600 focus:ring-red-500 cursor-pointer"
        />
        <span className="select-none font-medium leading-relaxed">
          I verify that <strong className="underline underline-offset-2">“{fileName || 'this import'}”</strong> is the exact import I want to delete, and I understand this action cannot be undone.
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-fg/10 bg-surface px-3 py-1.5 text-xs font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || !confirmed}
          className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-red-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600"
        >
          {busy ? 'Deleting…' : `Permanently Delete ${plural(deals, 'deal', 'deals')}`}
        </button>
      </div>
    </div>
  );
}
