import React from 'react';

// Bordered card with a title row, used across the admin pages
export default function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5 ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-fg/10 px-5 py-4">
        <div>
          <h2 className="font-display font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-subtle">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
