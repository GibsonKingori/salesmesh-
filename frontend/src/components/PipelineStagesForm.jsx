import React, { useEffect, useState } from 'react';
import api from '../api/client.js';

const fieldClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';
const buttonClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs font-medium text-fg-soft hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';

const stageId = (label, stages) => {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'stage';
  let id = base;
  let suffix = 2;
  while (stages.some((stage) => stage.id === id) || ['won', 'lost'].includes(id)) id = `${base.slice(0, 37)}-${suffix++}`;
  return id;
};

export default function PipelineStagesForm() {
  const [stages, setStages] = useState([]);
  const [addName, setAddName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings/pipeline')
      .then(({ data }) => setStages(data.stages))
      .catch((err) => setError(err.response?.data?.error || 'Could not load pipeline stages'))
      .finally(() => setLoading(false));
  }, []);

  const updateStage = (index, updates) => {
    setSaved(false);
    setStages((prev) => prev.map((stage, i) => (i === index ? { ...stage, ...updates } : stage)));
  };

  const moveOpenStage = (index, direction) => {
    setSaved(false);
    setStages((prev) => {
      const next = [...prev];
      const destination = index + direction;
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  const addStage = () => {
    const label = addName.trim();
    if (!label) return;
    setStages((prev) => [...prev.slice(0, -2), { id: stageId(label, prev), label, type: 'open' }, ...prev.slice(-2)]);
    setAddName('');
    setSaved(false);
  };

  const removeStage = (id) => {
    setStages((prev) => prev.filter((stage) => stage.id !== id));
    setSaved(false);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const { data } = await api.put('/settings/pipeline', { stages });
      setStages(data.stages);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save pipeline stages');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
      <div className="border-b border-fg/10 px-5 py-4">
        <h2 className="font-display font-semibold text-fg">Your business stages</h2>
        <p className="mt-0.5 text-xs text-subtle">
          Rename, add, or reorder in-progress stages to match your workflow. Completed and unsuccessful stages stay last so reports remain accurate. Move deals out before removing a stage.
        </p>
      </div>
      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted">Loading…</div>
      ) : (
        <>
          <ol className="divide-y divide-fg/5 px-5">
            {stages.map((stage, index) => {
              const isOpen = stage.type === 'open';
              const openIndex = stages.slice(0, -2).findIndex((item) => item.id === stage.id);
              const openStages = stages.slice(0, -2);
              return (
                <li key={stage.id} className="flex items-center gap-2 py-2.5">
                  <span className="w-6 shrink-0 text-xs tabular-nums text-subtle">{index + 1}.</span>
                  <input
                    aria-label={`${stage.type === 'won' ? 'Completed' : stage.type === 'lost' ? 'Unsuccessful' : 'In progress'} stage name`}
                    value={stage.label}
                    maxLength={40}
                    onChange={(event) => updateStage(index, { label: event.target.value })}
                    className={fieldClass}
                  />
                  <span className="hidden shrink-0 text-xs text-subtle sm:inline">
                    {isOpen ? 'In progress' : stage.type === 'won' ? 'Completed' : 'Unsuccessful'}
                  </span>
                  {isOpen ? (
                    <>
                      <button type="button" className={buttonClass} aria-label={`Move ${stage.label} up`} disabled={openIndex === 0} onClick={() => moveOpenStage(openIndex, -1)}>↑</button>
                      <button type="button" className={buttonClass} aria-label={`Move ${stage.label} down`} disabled={openIndex === openStages.length - 1} onClick={() => moveOpenStage(openIndex, 1)}>↓</button>
                      <button type="button" className={buttonClass} aria-label={`Remove ${stage.label}`} disabled={openStages.length <= 1} onClick={() => removeStage(stage.id)}>Remove</button>
                    </>
                  ) : <span className="w-[7.5rem] shrink-0" />}
                </li>
              );
            })}
          </ol>
          <div className="flex gap-2 border-t border-fg/10 px-5 py-3">
            <input
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              maxLength={40}
              placeholder="Add another stage"
              aria-label="New pipeline stage name"
              className={fieldClass}
            />
            <button type="button" onClick={addStage} disabled={!addName.trim()} className={buttonClass}>
              Add stage
            </button>
          </div>
        </>
      )}
      <div className="flex items-center justify-end gap-3 border-t border-fg/10 px-5 py-4">
        {error && <span className="mr-auto text-sm text-red-700 dark:text-red-300">{error}</span>}
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-300">Saved</span>}
        <button type="submit" disabled={saving || loading} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save stages'}
        </button>
      </div>
    </form>
  );
}
