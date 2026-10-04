import React, { useEffect, useState } from 'react';
import api from '../api/client.js';

const inputClass =
  'w-24 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-right text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';

const toPercentInput = (rate) => (rate === null ? '' : String(Math.round(rate * 1000) / 10));

// Admin-set conversion targets (System Configuration); the funnel on the Overview flags any stage below its target.
export default function ConversionTargetsForm() {
  const [rows, setRows] = useState([]); // [{ transition, value: '50' | '' }]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const applyBenchmarks = (benchmarks) =>
    setRows(benchmarks.map((b) => ({ transition: b.transition, value: toPercentInput(b.rate) })));

  useEffect(() => {
    api
      .get('/settings/benchmarks')
      .then((res) => applyBenchmarks(res.data.benchmarks))
      .catch((err) => setError(err.response?.data?.error || 'Could not load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const rates = Object.fromEntries(
        rows.map((r) => [r.transition, r.value.trim() === '' ? null : Number(r.value) / 100])
      );
      const { data } = await api.put('/settings/benchmarks', { rates });
      applyBenchmarks(data.benchmarks);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save targets');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="max-w-2xl rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5"
    >
      <div className="border-b border-fg/10 px-5 py-4">
        <h2 className="font-display font-semibold text-fg">Conversion targets</h2>
        <p className="mt-0.5 text-xs text-subtle">
          The share of deals you expect to move from one stage to the next. Stages below target are flagged on the
          Overview funnel. Leave a field blank for no target.
        </p>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted">Loading…</div>
      ) : (
        <ul className="divide-y divide-fg/5">
          {rows.map((r, idx) => {
            const [from, to] = r.transition.split('->');
            const id = `target-${r.transition}`;
            return (
              <li key={r.transition} className="flex items-center justify-between px-5 py-3">
                <label htmlFor={id} className="text-sm capitalize text-fg-soft">
                  {from} <span className="text-faint">&rarr;</span> {to}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="None"
                    value={r.value}
                    onChange={(e) => {
                      setSaved(false);
                      setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, value: e.target.value } : row)));
                    }}
                    className={inputClass}
                  />
                  <span className="text-sm text-subtle">%</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-fg/10 px-5 py-4">
        {error && <span className="mr-auto text-sm text-red-700 dark:text-red-300">{error}</span>}
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-300">Saved</span>}
        <button
          type="submit"
          disabled={saving || loading}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save targets'}
        </button>
      </div>
    </form>
  );
}
