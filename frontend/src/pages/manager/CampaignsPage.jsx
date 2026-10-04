import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import DashboardShell from '../../components/DashboardShell.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import AddCampaignModal from '../../components/AddCampaignModal.jsx';
import { currency, formatDate } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';

const dateRange = (c) => {
  if (!c.start_date && !c.end_date) return '—';
  return `${formatDate(c.start_date)} – ${formatDate(c.end_date)}`;
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const fetchCampaigns = () =>
    api
      .get('/analytics/campaigns')
      .then((res) => setCampaigns(res.data.campaigns))
      .catch((err) => setError(err.response?.data?.error || 'Could not load campaigns'))
      .finally(() => setLoading(false));

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const exportReport = () =>
    downloadCsv(
      'salesmesh-campaign-report.csv',
      ['Campaign', 'Channel', 'Start date', 'End date', 'Budget (KES)', 'Deals', 'CPA (KES)', 'ROI (%)'],
      campaigns.map((c) => [c.name, c.channel, c.start_date, c.end_date, c.budget, c.dealCount, c.cpa, c.roi])
    );

  return (
    <DashboardShell title="Campaigns">
      <div className="rounded-2xl border border-fg/10 bg-surface shadow-sm shadow-ink-900/5">
        <div className="flex items-center justify-between border-b border-fg/10 px-5 py-4">
          <div>
            <h2 className="font-display font-semibold text-fg">Campaigns</h2>
            <p className="mt-0.5 text-xs text-subtle">Cost per deal and return, from the deals linked to each campaign</p>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={exportReport}
            disabled={campaigns.length === 0}
            className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-50"
          >
            Export report
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
          >
            + New campaign
          </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted">Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState title="No campaigns yet" description="Create a campaign, then link deals to it to see CPA and ROI." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fg/10 text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 font-medium">Dates</th>
                  <th className="px-5 py-3 text-right font-medium">Budget</th>
                  <th className="px-5 py-3 text-right font-medium">Deals</th>
                  <th className="px-5 py-3 text-right font-medium">CPA</th>
                  <th className="px-5 py-3 text-right font-medium">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fg/5">
                {campaigns.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-fg/[0.03]">
                    <td className="px-5 py-3 font-medium text-fg">{c.name}</td>
                    <td className="px-5 py-3 text-muted">{c.channel || '—'}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{dateRange(c)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{currency(c.budget)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{c.dealCount}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{c.cpa === null ? '—' : currency(c.cpa)}</td>
                    <td
                      className={`px-5 py-3 text-right font-medium tabular-nums ${
                        c.roi === null ? 'text-muted' : c.roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {c.roi === null ? '—' : `${c.roi}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddCampaignModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            // Refetch so CPA/ROI/dealCount come from the API rather than being guessed here
            fetchCampaigns();
          }}
        />
      )}
    </DashboardShell>
  );
}
