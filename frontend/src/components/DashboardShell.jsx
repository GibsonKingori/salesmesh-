import React from 'react';
import Navbar from './Navbar.jsx';

export default function DashboardShell({ title, children }) {
  return (
    <div className="relative min-h-screen bg-canvas text-fg">
      <div className="bg-aurora pointer-events-none fixed inset-0" />
      <div className="bg-grid pointer-events-none fixed inset-0" />

      <div className="relative z-10">
        <Navbar title={title} />
        <main className="mx-auto max-w-6xl animate-fade-in-up px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
