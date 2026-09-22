import React, { useRef, useState } from 'react';
import api from '../api/client.js';
import Modal from './Modal.jsx';

const SAMPLE_CSV =
  'title,value,stage,expected_close_date,owner_email\n' +
  'Acme Corp - Annual Contract,450000,negotiation,2026-11-30,\n' +
  'Jua Kali Traders - POS Rollout,120000,won,,\n';

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'salesmesh-deals-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportCsvModal({ onClose, onImported }) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }

    setError('');
    setResult(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/deals/import', formData);
      setResult(data);
      onImported();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Import deals from CSV" onClose={onClose}>
      <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
        Columns: <code className="text-slate-300">title, value, stage, expected_close_date, owner_email</code>.{' '}
        <code className="text-slate-300">expected_close_date</code> and{' '}
        <code className="text-slate-300">owner_email</code> are optional — leave blank to assign the deal to you.
        <button type="button" onClick={downloadSample} className="mt-2 block font-medium text-brand-300 hover:text-brand-200">
          Download a sample CSV
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-4 py-8 text-center transition-colors hover:border-brand-400/40 hover:bg-white/[0.05]">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
          />
          <svg viewBox="0 0 24 24" fill="none" className="mb-2 h-6 w-6 text-slate-500" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
          </svg>
          <span className="text-sm text-slate-300">{fileName || 'Click to choose a .csv file'}</span>
        </label>

        {result && (
          <div className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
            <p>Imported {result.imported} deal{result.imported === 1 ? '' : 's'}.</p>
            {result.skipped?.length > 0 && (
              <div className="text-xs text-amber-300">
                <p className="font-medium">Skipped {result.skipped.length} row(s):</p>
                <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Importing…' : 'Import CSV'}
        </button>
      </form>
    </Modal>
  );
}
