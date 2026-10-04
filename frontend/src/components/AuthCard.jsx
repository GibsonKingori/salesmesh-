import React from 'react';
import { LogoMark } from './Logo.jsx';

export const authInputClass =
  'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/50 focus:bg-surface focus:ring-2 focus:ring-brand-500/15';

export const authButtonClass =
  'w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60';

// Centred card used by the forgot-password and reset-password pages
export default function AuthCard({ title, subtitle, children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="bg-aurora pointer-events-none fixed inset-0" />
      <div className="bg-grid pointer-events-none fixed inset-0" />
      <div className="relative z-10 w-full max-w-sm animate-fade-in-up rounded-2xl border border-fg/10 bg-surface p-8 shadow-xl shadow-ink-900/10">
        <div className="mb-6 text-center">
          <LogoMark className="mx-auto mb-4 h-11 w-11" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
