import React, { useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { currency } from '../lib/format.js';
import { downloadCsv, toCsv } from '../lib/csv.js';
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

// Anything services/importReaders.js can read. Screenshots and PDFs are read by AI.
const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,.numbers,.json,.pdf,image/png,image/jpeg,image/webp,image/gif';

const EXTRACTED_LABELS = {
  title: 'Deal',
  value: 'Value',
  stage: 'Stage',
  created_date: 'Created',
  closed_date: 'Closed',
  expected_close_date: 'Expected close',
  campaign: 'Campaign',
  contact_name: 'Contact',
  company: 'Company',
  contact_email: 'Email',
  contact_phone: 'Phone',
  owner: 'Owner',
};

// What each of the user's columns can be matched to (services/dealImport.js IMPORT_FIELDS)
const FIELD_OPTIONS = [
  ['title', 'Deal / product name'],
  ['value', 'Amount'],
  ['stage', 'Status'],
  ['created_date', 'Date started / sale date'],
  ['closed_date', 'Date closed / paid'],
  ['expected_close_date', 'Expected close date'],
  ['close_date', 'Close date (actual or expected)'],
  ['contact_name', 'Customer name'],
  ['company', 'Customer company'],
  ['contact_phone', 'Customer phone'],
  ['contact_email', 'Customer email'],
  ['campaign', 'Campaign'],
  ['owner', 'Salesperson'],
];

const selectClass =
  'rounded-md border border-fg/10 bg-surface px-2 py-1 text-xs text-fg focus:border-brand-400/50 focus:outline-none';

// Each column in the user's file and what it was matched to; changing one re-checks the file
function ColumnMatches({ columns, isManager, disabled, onChange }) {
  const options = FIELD_OPTIONS.filter(([f]) => isManager || f !== 'owner');
  return (
    <div className="space-y-1.5">
      {columns.map(({ header, field }, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-fg-soft" title={header}>
            {header || <span className="text-subtle">(no heading)</span>}
          </span>
          <select
            value={field || ''}
            disabled={disabled}
            onChange={(e) => onChange(i, e.target.value || null)}
            className={`${selectClass} w-48 shrink-0`}
          >
            <option value="">Not used</option>
            {options.map(([f, label]) => (
              <option key={f} value={f}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

const STAGE_OPTIONS = [
  ['won', 'Won (completed sale)'],
  ['lost', 'Lost (cancelled)'],
  ['negotiation', 'Negotiation (part paid)'],
  ['proposal', 'Proposal (quoted)'],
  ['qualified', 'Qualified (interested)'],
  ['lead', 'Lead (new enquiry)'],
];

// Same as simplify() in services/dealImport.js, which keys the status mapping
const simplify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Each status word in the user's file and the stage it was read as; changing one re-checks the file
function StatusMatches({ statuses, disabled, onChange }) {
  return (
    <div className="space-y-1.5">
      {statuses.map(({ value, count, stage, matched }) => (
        <div key={value} className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-fg-soft" title={value}>
            “{value}” <span className="text-subtle">× {count}</span>
            {!matched && <span className="text-amber-700 dark:text-amber-300"> · not recognised</span>}
          </span>
          <select value={stage} disabled={disabled} onChange={(e) => onChange(value, e.target.value)} className={`${selectClass} w-48 shrink-0`}>
            {STAGE_OPTIONS.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

// The rows AI read from a screenshot, so the user can compare them with the picture before importing
function ExtractedTable({ extracted }) {
  // Hide columns that are empty in every row
  const cols = extracted.headers.map((h, i) => [h, i]).filter(([, i]) => extracted.rows.some((r) => r[i]));
  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-fg/10">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">#</th>
            {cols.map(([h]) => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                {EXTRACTED_LABELS[h] || h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-fg/5 text-fg-soft">
          {extracted.rows.map((r, n) => (
            <tr key={n}>
              <td className="px-2 py-1 text-subtle">{n + 1}</td>
              {cols.map(([h, i]) => (
                <td key={h} className="whitespace-nowrap px-2 py-1">
                  {r[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

  const [dragging, setDragging] = useState(false);

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    setError('');
  };

  // Screenshots can be pasted straight in (Ctrl+V) while choosing a file
  useEffect(() => {
    if (preview || result) return undefined;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file');
      const pasted = item?.getAsFile();
      if (!pasted) return;
      e.preventDefault();
      const ext = (pasted.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      pickFile(new File([pasted], `pasted-screenshot.${ext}`, { type: pasted.type }));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [preview, result]);

  // Once a file has been checked, later checks and the import reuse what the user saw: the rows
  // read from a picture (so it isn't read again) and the column matching, as they may have changed it
  const send = async (dryRun, { mapping, defaultStage } = {}) => {
    const formData = new FormData();
    const upload = preview?.extracted
      ? new File([toCsv(preview.extracted.headers, preview.extracted.rows)], 'read-from-image.csv', { type: 'text/csv' })
      : file;
    formData.append('file', upload);
    if (mapping) formData.append('mapping', JSON.stringify(mapping));
    if (defaultStage) formData.append('defaultStage', defaultStage);
    return (await api.post(`/deals/import${dryRun ? '?dryRun=1' : ''}`, formData)).data;
  };

  const current = () => (preview ? { mapping: preview.mapping, defaultStage: preview.defaultStage } : {});

  const recheck = async (changes) => {
    setError('');
    setLoading(true);
    try {
      const next = await send(true, { ...current(), ...changes });
      // Keep the rows read from a picture: the re-check was made from them
      setPreview(preview?.extracted ? { ...next, extracted: preview.extracted, notes: preview.notes } : next);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not check the file again');
    } finally {
      setLoading(false);
    }
  };

  const changeColumn = (index, field) => {
    const columns = preview.mapping.columns.map((f, i) => {
      if (i === index) return field;
      return field && f === field ? null : f; // a field belongs to one column
    });
    recheck({ mapping: { ...preview.mapping, columns, mappedBy: 'user' } });
  };

  const changeStatus = (value, stage) =>
    recheck({ mapping: { ...preview.mapping, stages: { ...preview.mapping.stages, [simplify(value)]: stage }, mappedBy: 'user' } });

  const check = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Choose a file or paste a screenshot first');
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
      setResult(await send(false, current()));
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
            Checked <span className="font-medium text-fg">{file?.name}</span>
            {preview.sheet ? ` (sheet “${preview.sheet}”)` : ''}. Nothing has been saved yet.
          </p>
          {preview.extracted && (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Read from the picture by AI. Check these rows against it, especially amounts and dates. To fix
                anything,{' '}
                <button
                  type="button"
                  onClick={() => downloadCsv('read-from-image.csv', preview.extracted.headers, preview.extracted.rows)}
                  className="font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
                >
                  download them as a CSV
                </button>
                , edit, and upload that instead.
              </p>
              <ExtractedTable extracted={preview.extracted} />
            </div>
          )}
          {preview.notes?.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              {preview.notes.map((n) => (
                <li key={n}>Check: {n}</li>
              ))}
            </ul>
          )}
          <dl className="space-y-1.5 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5 text-sm">
            <Row label={preview.extracted ? 'Rows found' : 'Rows in file'}>{preview.rows}</Row>
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
          {(!preview.stageColumn || preview.defaultedRows > 0) && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5 text-xs text-fg-soft">
              <span>{preview.stageColumn ? 'Deals with no status are:' : 'Your file has no status column. These deals are:'}</span>
              <select
                value={preview.defaultStage}
                disabled={loading}
                onChange={(e) => recheck({ defaultStage: e.target.value })}
                className={`${selectClass} shrink-0`}
              >
                <option value="won">Completed sales (won)</option>
                <option value="lead">New enquiries (lead)</option>
                <option value="qualified">Interested (qualified)</option>
                <option value="proposal">Quoted (proposal)</option>
                <option value="negotiation">In negotiation</option>
                <option value="lost">Lost</option>
              </select>
            </label>
          )}
          <SkippedList skipped={preview.skipped} />
          {preview.statuses?.length > 0 && (
            <details
              className="rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5"
              open={preview.checkColumns || preview.statuses.some((s) => !s.matched)}
            >
              <summary className="cursor-pointer text-xs font-medium text-fg-soft">
                How your statuses were read<span className="font-normal text-subtle"> · change any that are wrong</span>
              </summary>
              <div className="mt-2.5">
                <StatusMatches statuses={preview.statuses} disabled={loading} onChange={changeStatus} />
              </div>
            </details>
          )}
          {!preview.extracted && preview.columns?.length > 0 && (
            <details className="rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5" open={preview.checkColumns || preview.imported === 0}>
              <summary className="cursor-pointer text-xs font-medium text-fg-soft">
                {preview.mappedBy === 'ai' ? 'Columns matched by AI' : 'How your columns were read'}
                <span className="font-normal text-subtle"> · change any that are wrong</span>
              </summary>
              <div className="mt-2.5">
                <ColumnMatches columns={preview.columns} isManager={isManager} disabled={loading} onChange={changeColumn} />
              </div>
            </details>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={reset} className={secondaryClass}>
              Choose another file
            </button>
            <button onClick={importNow} disabled={loading || preview.imported === 0} className={buttonClass}>
              {loading ? 'Working…' : `Import ${preview.imported} deal${preview.imported === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={check} className="space-y-4">
          <div className="space-y-2 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <p>
              Upload your sales records as they are: Excel, CSV, PDF, or a screenshot or photo. Any column names
              work, and you can check how each column was read before anything is saved. Dates make forecasts more
              accurate.
            </p>
            <button type="button" onClick={downloadTemplate} className="font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
              Starting from scratch? Download the template
            </button>
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors hover:border-brand-400/40 hover:bg-fg/[0.05] ${
              dragging ? 'border-brand-400/60 bg-brand-500/10' : 'border-fg/15 bg-fg/[0.03]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <svg viewBox="0 0 24 24" fill="none" className="mb-2 h-6 w-6 text-subtle" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
            </svg>
            <span className="text-sm text-fg-soft">{file?.name || 'Click to choose a file, drop it here, or paste a screenshot'}</span>
            <span className="mt-1 text-xs text-subtle">Excel, CSV, PDF, or a screenshot or photo (read by AI) · up to 10 MB</span>
          </label>

          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? (/^image\/|pdf$/.test(file?.type || '') ? 'Reading the picture… this can take a minute or two' : 'Checking…') : 'Check file'}
          </button>
        </form>
      )}
    </Modal>
  );
}
