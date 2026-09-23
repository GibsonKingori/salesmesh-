import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from './Logo.jsx';

const ROLE_LABELS = {
  manager: 'Manager',
  representative: 'Representative',
  admin: 'Admin',
};

// `end` on the overview link so it isn't highlighted on every nested page
const NAV_LINKS = {
  manager: [
    { to: '/manager', label: 'Overview', end: true },
    { to: '/manager/deals', label: 'Deals' },
    { to: '/manager/campaigns', label: 'Campaigns' },
    { to: '/manager/settings', label: 'Settings' },
  ],
  representative: [
    { to: '/rep', label: 'Overview', end: true },
    { to: '/rep/deals', label: 'Deals' },
  ],
};
NAV_LINKS.admin = NAV_LINKS.manager;

export default function Navbar({ title }) {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const links = NAV_LINKS[user?.role] || [];

  const handleLogout = () => {
    setLoggingOut(true);
    setTimeout(logout, 500);
  };

  return (
    <>
      <header className="dark sticky top-0 z-20 border-b border-fg/[0.06] bg-canvas/95 text-fg backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Logo textClassName="text-sm" subtitle={title} />

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none text-fg">{user?.name}</p>
              <p className="mt-1 text-xs text-muted">{ROLE_LABELS[user?.role] || user?.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 font-display text-sm font-bold text-white shadow-md shadow-brand-500/30 ring-2 ring-brand-300/40">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:border-fg/20 hover:bg-fg/10 hover:text-fg"
            >
              Log out
            </button>
          </div>
        </div>

        {links.length > 0 && (
          <nav className="no-scrollbar mx-auto max-w-6xl overflow-x-auto overflow-y-hidden px-6" aria-label="Main">
            <ul className="flex gap-1">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      `block whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-brand-400 text-fg'
                          : 'border-transparent text-muted hover:text-fg'
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="hairline-glow h-px w-full opacity-60" />
      </header>

      {loggingOut && (
        <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-canvas/95 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg/10 border-t-brand-400" />
          <p className="text-sm text-muted">Signing out…</p>
        </div>
      )}
    </>
  );
}
