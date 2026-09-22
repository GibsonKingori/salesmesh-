import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import StatCard from '../../components/StatCard.jsx';
import StageBadge from '../../components/StageBadge.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import AddDealModal from '../../components/AddDealModal.jsx';
import ImportCsvModal from '../../components/ImportCsvModal.jsx';
import AddCampaignModal from '../../components/AddCampaignModal.jsx';
import ConversionFunnelChart from '../../components/ConversionFunnelChart.jsx';

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
  forecast: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </svg>
  ),
};

export default function ManagerDashboard() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pipeline, setPipeline] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAddCampaign, setShowAddCampaign] = useState(false);

  const fetchDeals = () => {
    setLoading(true);
    api
      .get('/deals')
      .then((res) => setDeals(res.data.deals))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchAnalytics = () => {
    api.get('/analytics/pipeline').then((res) => setPipeline(res.data)).catch(() => {});
    api.get('/analytics/campaigns').then((res) => setCampaigns(res.data.campaigns)).catch(() => {});
  };

  useEffect(() => {
    fetchDeals();
    fetchAnalytics();
  }, []);

  const totalValue = deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const wonValue = deals.filter((d) => d.stage === 'won').reduce((sum, d) => sum + Number(d.value || 0), 0);
  const openDeals = deals.filter((d) => !['won', 'lost'].includes(d.stage)).length;

  return (
    <DashboardShell title="Manager Dashboard">
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Pipeline value" value={currency(totalValue)} hint={`${deals.length} total deals`} icon={ICONS.pipeline} />
        <StatCard label="Open deals" value={openDeals} hint="Not yet won or lost" icon={ICONS.open} />
        <StatCard label="Won value" value={currency(wonValue)} hint="Closed-won deals" icon={ICONS.won} />
      </div>

      {pipeline && (
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl backdrop-blur-xl">
            <h2 className="mb-4 font-display font-semibold text-white">Conversion funnel</h2>
            <ConversionFunnelChart stages={pipeline.diagnostic.stages} transitions={pipeline.diagnostic.transitions} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl backdrop-blur-xl">
            <h2 className="mb-1 font-display font-semibold text-white">Revenue forecast</h2>
            <p className="mb-4 text-xs text-slate-500">
              {pipeline.predictive.basis === 'no_won_deals'
                ? 'Trend-based — needs won deals to project from.'
                : `Trend-based, ~${currency(pipeline.predictive.dailyRate)}/day`}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[30, 60, 90].map((h) => (
                <div key={h} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{h}d</p>
                  <p className="mt-1 font-display text-lg font-bold text-white">{currency(pipeline.predictive[`day${h}`])}</p>
                </div>
              ))}
            </div>
            {pipeline.velocity.velocity > 0 && (
              <p className="mt-4 text-xs text-slate-500">
                Pipeline velocity: <span className="text-slate-300">{currency(pipeline.velocity.velocity)}/day</span>
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-display font-semibold text-white">Campaigns</h2>
          <button
            onClick={() => setShowAddCampaign(true)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
          >
            + New campaign
          </button>
        </div>

        {campaigns.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState title="No campaigns yet" description="Create a campaign, then link deals to it to see CPA and ROI." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-5 py-3 font-medium">Budget</th>
                  <th className="px-5 py-3 font-medium">Deals</th>
                  <th className="px-5 py-3 font-medium">CPA</th>
                  <th className="px-5 py-3 font-medium">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {campaigns.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-white/[0.04]">
                    <td className="px-5 py-3 font-medium text-slate-100">{c.name}</td>
                    <td className="px-5 py-3 text-slate-400">{currency(c.budget)}</td>
                    <td className="px-5 py-3 text-slate-400">{c.dealCount}</td>
                    <td className="px-5 py-3 text-slate-400">{c.cpa === null ? '—' : currency(c.cpa)}</td>
                    <td className={`px-5 py-3 font-medium ${c.roi === null ? 'text-slate-400' : c.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {c.roi === null ? '—' : `${c.roi}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-display font-semibold text-white">Team deals</h2>
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
              title="No deals yet"
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
            fetchAnalytics();
          }}
        />
      )}

      {showImport && (
        <ImportCsvModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            fetchDeals();
            fetchAnalytics();
          }}
        />
      )}

      {showAddCampaign && (
        <AddCampaignModal
          onClose={() => setShowAddCampaign(false)}
          onCreated={(campaign) => {
            setCampaigns((prev) => [{ ...campaign, cpa: null, roi: null, dealCount: 0 }, ...prev]);
            setShowAddCampaign(false);
          }}
        />
      )}
    </DashboardShell>
  );
}
