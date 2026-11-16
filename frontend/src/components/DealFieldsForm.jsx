import React, { useEffect, useState } from 'react';
import api from '../api/client.js';

const fieldClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';
const buttonClass =
  'rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs font-medium text-fg-soft hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const MAX_FIELDS = 20;

const fieldId = (label, fields) => {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'field';
  let id = base;
  let suffix = 2;
  while (fields.some((field) => field.id === id)) id = `${base.slice(0, 37)}-${suffix++}`;
  return id;
};

const typeLabel = { text: 'Text', number: 'Number', date: 'Date', boolean: 'Yes / no' };

export default function DealFieldsForm() {
  const [fields, setFields] = useState([]);
  const [addLabel, setAddLabel] = useState('');
  const [addType, setAddType] = useState('text');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings/deal-fields')
      .then(({ data }) => setFields(data.fields))
      .catch((err) => setError(err.response?.data?.error || 'Could not load custom fields'))
      .finally(() => setLoading(false));
  }, []);

  const updateField = (index, updates) => {
    setSaved(false);
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...updates } : field)));
  };

  const addField = () => {
    const label = addLabel.trim();
    if (!label || fields.length >= MAX_FIELDS) return;
    setFields((prev) => [...prev, { id: fieldId(label, prev), label, type: addType, active: true }]);
    setAddLabel('');
    setSaved(false);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const { data } = await api.put('/settings/deal-fields', { fields });
      setFields(data.fields);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save custom fields');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
      <div className="border-b border-fg/10 px-5 py-4">
        <h2 className="font-display font-semibold text-fg">Business-specific deal fields</h2>
        <p className="mt-0.5 text-xs text-subtle">
          Add details your business tracks, such as service type, location, or renewal date. They appear on deal forms and can be matched during imports. Hidden fields and saved values are kept.
        </p>
      </div>
      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted">Loading…</div>
      ) : (
        <>
          {fields.length > 0 && (
            <ol className="divide-y divide-fg/5 px-5">
              {fields.map((field, index) => (
                <li key={field.id} className="flex items-center gap-2 py-2.5">
                  <input
                    aria-label={`${field.label} field name`}
                    value={field.label}
                    maxLength={50}
                    onChange={(event) => updateField(index, { label: event.target.value })}
                    className={fieldClass}
                  />
                  <span className="w-20 shrink-0 text-xs text-subtle">{typeLabel[field.type]}</span>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`${field.active ? 'Hide' : 'Show'} ${field.label}`}
                    onClick={() => updateField(index, { active: !field.active })}
                  >
                    {field.active ? 'Hide' : 'Show'}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="grid gap-2 border-t border-fg/10 px-5 py-3 sm:grid-cols-[1fr_8rem_auto]">
            <input
              value={addLabel}
              onChange={(event) => setAddLabel(event.target.value)}
              maxLength={50}
              placeholder="Add a field, e.g. Service type"
              aria-label="New deal field name"
              className={fieldClass}
            />
            <select value={addType} onChange={(event) => setAddType(event.target.value)} className={`${fieldClass} appearance-none`}>
              {Object.entries(typeLabel).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </select>
            <button type="button" onClick={addField} disabled={!addLabel.trim() || fields.length >= MAX_FIELDS} className={buttonClass}>
              Add field
            </button>
          </div>
        </>
      )}
      <div className="flex items-center justify-end gap-3 border-t border-fg/10 px-5 py-4">
        {error && <span className="mr-auto text-sm text-red-700 dark:text-red-300">{error}</span>}
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-300">Saved</span>}
        <button type="submit" disabled={saving || loading} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save fields'}
        </button>
      </div>
    </form>
  );
}
