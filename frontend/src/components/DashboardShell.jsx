import React from 'react';
import Navbar from './Navbar.jsx';

export default function DashboardShell({ title, children }) {
  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed -top-32 left-1/3 h-96 w-96 rounded-full bg-brand-600/8 blur-[120px]" />
      <div className="bg-grid pointer-events-none fixed inset-0" />

      <div className="relative z-10">
        <Navbar title={title} />
        <main className="mx-auto max-w-6xl animate-fade-in-up px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
