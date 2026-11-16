import React from 'react';

const inputClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20';

export default function DealCustomFields({ fields = [], values = {}, disabled = false, onChange }) {
  const activeFields = fields.filter((field) => field.active !== false);
  if (!activeFields.length) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-fg-soft">Business details</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {activeFields.map((field) => (
          <label key={field.id} className={field.type === 'boolean' ? 'flex items-center gap-2 text-sm text-fg-soft' : 'block'}>
            {field.type === 'boolean' ? (
              <>
                <input
                  type="checkbox"
                  checked={values[field.id] === true}
                  disabled={disabled}
                  onChange={(event) => onChange(field.id, event.target.checked)}
                  className="h-4 w-4 rounded border-fg/20 accent-brand-600"
                />
                <span>{field.label}</span>
              </>
            ) : (
              <>
                <span className="mb-1 block text-sm font-medium text-fg-soft">{field.label}</span>
                <input
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  step={field.type === 'number' ? 'any' : undefined}
                  value={values[field.id] ?? ''}
                  disabled={disabled}
                  onChange={(event) => onChange(field.id, event.target.value)}
                  className={`${inputClass} ${field.type === 'date' ? 'dark:[color-scheme:dark]' : ''}`}
                />
              </>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}
