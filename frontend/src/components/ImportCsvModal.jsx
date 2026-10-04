import React, { useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { currency } from '../lib/format.js';
import { downloadCsv } from '../lib/csv.js';
import Modal from './Modal.jsx';

// Template matching services/dealImport.js. Dates are day-first, as Kenyan records usually are.
const TEMPLATE_HEADER = [
  'title',
  'value',
  'stage',
  'created_date',
  'closed_date',
  'expected_close_date',
  'campaign',
  'contact_name',
  'company',
  'contact_email',
  'contact_phone',
  'owner',
];
const TEMPLATE_ROWS = [
  ['Shop shelving', '120000', 'won', '02/03/2026', '20/03/2026', '', '', 'Jane Achieng', 'Achieng Hardware', 'jane@achieng.co.ke', '0712345678', ''],
  ['Bulk cement order', '450000', 'proposal', '15/09/2026', '', '30/11/2026', '', 'Peter Kamau', 'Kamau Builders', '', '0722000111', ''],
  ['Roofing sheets', '90000', 'lost', '01/04/2026', '10/04/2026', '', '', 'Peter Kamau', 'Kamau Builders', '', '', ''],
];

const STAGE_ORDER = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-muted">{label}</dt>
    <dd className="text-right font-medium text-fg">{children}</dd>
  </div>
);

function SkippedList({ skipped }) {
  if (!skipped?.length) return null;
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
      <p className="font-medium">
        {skipped.length} row{skipped.length === 1 ? '' : 's'} will be skipped. Fix {skipped.length === 1 ? 'it' : 'them'} in the file and check again:
      </p>
      <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
        {skipped.map((s) => (
          <li key={s.row}>
            Row {s.row}: {s.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Step 1: choose a file. Step 2: the API checks it (dry run) and we show what will happen.
// Step 3: import. Nothing is saved until the user confirms the preview.
export default function ImportCsvModal({ onClose, onImported }) {
  const { user } = useAuth();
  const isManager = ['manager', 'admin'].includes(user?.role);
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const send = async (dryRun) => {
    const formData = new FormData();
    formData.append('file', file);
    return (await api.post(`/deals/import${dryRun ? '?dryRun=1' : ''}`, formData)).data;
  };

  const check = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }
    setError('');
    setLoading(true);
    try {
      setPreview(await send(true));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not read that file');
    } finally {
      setLoading(false);
    }
  };

  const importNow = async () => {
    setError('');
    setLoading(true);
    try {
      setResult(await send(false));
      onImported();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = () =>
    downloadCsv(
      'salesmesh-deals-template.csv',
      isManager ? TEMPLATE_HEADER : TEMPLATE_HEADER.slice(0, -1),
      TEMPLATE_ROWS.map((r) => (isManager ? r : r.slice(0, -1)))
    );

  const buttonClass =
    'w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60';
  const secondaryClass =
    'w-full rounded-lg border border-fg/10 bg-fg/5 py-2.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg';

  return (
    <Modal title="Import deals from your records" onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 dark:text-emerald-200">
            Imported {result.imported} deal{result.imported === 1 ? '' : 's'} worth {currency(result.totalValue)}
            {result.newContacts ? `, and added ${result.newContacts} new contact${result.newContacts === 1 ? '' : 's'}` : ''}.
          </div>
          <SkippedList skipped={result.skipped} />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={reset} className={secondaryClass}>
              Import another file
            </button>
            <button onClick={onClose} className={buttonClass}>
              Done
            </button>
          </div>
        </div>
      ) : preview ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-soft">
            Checked <span className="font-medium text-fg">{file?.name}</span>. Nothing has been saved yet.
          </p>
          <dl className="space-y-1.5 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5 text-sm">
            <Row label="Rows in file">{preview.rows}</Row>
            <Row label="Deals to import">{preview.imported}</Row>
            <Row label="Total value">{currency(preview.totalValue)}</Row>
            <Row label="By stage">
              {STAGE_ORDER.filter((s) => preview.byStage[s])
                .map((s) => `${preview.byStage[s]} ${s}`)
                .join(' · ') || '—'}
            </Row>
            <Row label="New contacts">{preview.newContacts}</Row>
          </dl>
          {preview.warnings?.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2.5 text-xs text-sky-800 dark:text-sky-200">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <SkippedList skipped={preview.skipped} />
          <p className="text-xs text-subtle">Columns used: {preview.recognisedColumns.join(', ')}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={reset} className={secondaryClass}>
              Choose another file
            </button>
            <button onClick={importNow} disabled={loading || preview.imported === 0} className={buttonClass}>
              {loading ? 'Importing…' : `Import ${preview.imported} deal${preview.imported === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={check} className="space-y-4">
          <div className="space-y-2 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <p>
              Needs <code className="text-fg-soft">title</code>, <code className="text-fg-soft">value</code> and{' '}
              <code className="text-fg-soft">stage</code>. For accurate forecasts also include{' '}
              <code className="text-fg-soft">created_date</code> and, for won/lost deals,{' '}
              <code className="text-fg-soft">closed_date</code> (DD/MM/YYYY).
            </p>
            <p>
              Optional: campaign (must already exist), contact name, company, email, phone
              {isManager ? ', and owner (the salesperson’s email or full name)' : ''}. Common headings like “Amount” or
              “Customer” are recognised.
            </p>
            <button type="button" onClick={downloadTemplate} className="font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
              Download the template
            </button>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-fg/15 bg-fg/[0.03] px-4 py-8 text-center transition-colors hover:border-brand-400/40 hover:bg-fg/[0.05]">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError('');
              }}
            />
            <svg viewBox="0 0 24 24" fill="none" className="mb-2 h-6 w-6 text-subtle" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
            </svg>
            <span className="text-sm text-fg-soft">{file?.name || 'Click to choose a .csv file'}</span>
            <span className="mt-1 text-xs text-subtle">In Excel: File → Save As → CSV UTF-8</span>
          </label>

          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? 'Checking…' : 'Check file'}
          </button>
        </form>
      )}
    </Modal>
  );
}
