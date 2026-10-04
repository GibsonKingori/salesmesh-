import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import DashboardShell from '../components/DashboardShell.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Panel from '../components/Panel.jsx';
import { currency } from '../lib/format.js';

// "View Campaign Results" for a representative: how their own deals from each campaign are doing.
// Budget, CPA and ROI are manager-only and are not sent to this page.
export default function CampaignResultsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/analytics/campaigns/me')
      .then((res) => setCampaigns(res.data.campaigns))
      .catch((err) => setError(err.response?.data?.error || 'Could not load campaign results'))
      .finally(() => setLoading(false));
  }, []);

  // Campaigns with the rep's deals first, then the rest
  const sorted = [...campaigns].sort((a, b) => b.dealCount - a.dealCount);

  return (
    <DashboardShell title="Campaign results">
      <Panel title="My campaign results" subtitle="Your deals from each marketing campaign">
        {error && (
          <div className="mx-5 mt-4 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState title="No campaigns yet" description="When your manager runs a campaign, link your deals to it to see results here." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fg/10 text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 text-right font-medium">My deals</th>
                  <th className="px-5 py-3 text-right font-medium">Won</th>
                  <th className="px-5 py-3 text-right font-medium">Won value</th>
                  <th className="px-5 py-3 text-right font-medium">Open value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fg/5">
                {sorted.map((c) => (
                  <tr key={c.id} className={`transition-colors hover:bg-fg/[0.03] ${c.dealCount === 0 ? 'text-subtle' : ''}`}>
                    <td className="px-5 py-3 font-medium text-fg">{c.name}</td>
                    <td className="px-5 py-3 text-muted">{c.channel || '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{c.dealCount}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{c.wonCount}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      {c.wonValue ? currency(c.wonValue) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{c.openValue ? currency(c.openValue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </DashboardShell>
  );
}
