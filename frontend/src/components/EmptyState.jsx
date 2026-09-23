import React from 'react';

export default function EmptyState({ title, description }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-fg/10 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-fg/5 text-subtle ring-1 ring-fg/10">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6M5 6h14a1 1 0 011 1v13l-4-2-4 2-4-2-4 2V7a1 1 0 011-1z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs text-subtle">{description}</p>}
    </div>
  );
}
