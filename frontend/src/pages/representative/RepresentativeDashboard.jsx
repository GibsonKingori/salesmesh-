import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import StatCard from '../../components/StatCard.jsx';
import StageBadge from '../../components/StageBadge.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import AddDealModal from '../../components/AddDealModal.jsx';
import ImportCsvModal from '../../components/ImportCsvModal.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n || 0);

const ICONS = {
  pipeline: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 15l4-5 3 3 5-7" />
    </svg>
  ),
  open: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  ),
  won: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
};

export default function RepresentativeDashboard() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const fetchDeals = () => {
    setLoading(true);
    api
      .get('/deals')
      .then((res) => setDeals(res.data.deals))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchDeals, []);

  const myValue = deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const openDeals = deals.filter((d) => !['won', 'lost'].includes(d.stage)).length;
  const wonDeals = deals.filter((d) => d.stage === 'won').length;

  return (
    <DashboardShell title="My Deals">
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="My pipeline value" value={currency(myValue)} hint={`${deals.length} total deals`} icon={ICONS.pipeline} />
        <StatCard label="Open deals" value={openDeals} hint="Still in progress" icon={ICONS.open} />
        <StatCard label="Won deals" value={wonDeals} hint="Closed-won" icon={ICONS.won} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-display font-semibold text-white">Your deals</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              Import CSV
            </button>
            <button
              onClick={() => setShowAddDeal(true)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
            >
              + Add deal
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">Loading deals…</div>
        ) : deals.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState
              title="No deals assigned to you yet"
              description="Add your first deal or import a CSV of existing deals to get started."
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.04]">
                <span className="text-sm font-medium text-slate-100">{d.title}</span>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-slate-400">{currency(d.value)}</span>
                  <StageBadge stage={d.stage} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddDeal && (
        <AddDealModal
          onClose={() => setShowAddDeal(false)}
          onCreated={(deal) => {
            setDeals((prev) => [deal, ...prev]);
            setShowAddDeal(false);
          }}
        />
      )}

      {showImport && (
        <ImportCsvModal
          onClose={() => setShowImport(false)}
          onImported={fetchDeals}
        />
      )}
    </DashboardShell>
  );
}
