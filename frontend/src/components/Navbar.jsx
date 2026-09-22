import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const ROLE_LABELS = {
  manager: 'Manager',
  representative: 'Representative',
  admin: 'Admin',
};

export default function Navbar({ title }) {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = () => {
    setLoggingOut(true);
    setTimeout(logout, 500);
  };

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              S
            </div>
            <div>
              <p className="font-display text-sm font-semibold leading-none tracking-tight text-white">
                SalesMesh
              </p>
              <p className="mt-1 text-xs text-slate-400">{title}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none text-slate-100">{user?.name}</p>
              <p className="mt-1 text-xs text-slate-400">{ROLE_LABELS[user?.role] || user?.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-brand-300 ring-1 ring-white/10">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {loggingOut && (
        <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-slate-950/95 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-brand-400" />
          <p className="text-sm text-slate-400">Signing out…</p>
        </div>
      )}
    </>
  );
}
