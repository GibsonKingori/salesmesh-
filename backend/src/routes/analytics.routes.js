import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { fetchAll } from '../services/fetchAll.js';
import {
  descriptiveSummary,
  conversionFunnel,
  forecastRevenue,
  pipelineVelocity,
  campaignCPA,
  campaignROI,
} from '../services/analytics.js';

const router = express.Router();
router.use(requireAuth);

// Manager-set target rates, as { 'lead->qualified': 0.5, ... }
export async function loadBenchmarks() {
  const { data, error } = await supabase.from('funnel_benchmarks').select('transition, rate');
  if (error) throw error;
  return Object.fromEntries(data.map((b) => [b.transition, Number(b.rate)]));
}

async function pipelineAnalytics(deals) {
  return {
    descriptive: descriptiveSummary(deals),
    diagnostic: conversionFunnel(deals, await loadBenchmarks()),
    predictive: forecastRevenue(deals),
    velocity: pipelineVelocity(deals),
  };
}

// GET /api/analytics/pipeline — descriptive + diagnostic + predictive, team-wide
router.get('/pipeline', requireRole('manager', 'admin'), async (req, res) => {
  const { data: deals, error } = await fetchAll(() => supabase.from('deals').select('*').order('id'));
  if (error) return res.status(400).json({ error: error.message });

  try {
    return res.json(await pipelineAnalytics(deals));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/analytics/me — the same analytics, scoped to the caller's own deals
router.get('/me', async (req, res) => {
  const { data: deals, error } = await fetchAll(() => supabase.from('deals').select('*').eq('owner_id', req.user.id).order('id'));
  if (error) return res.status(400).json({ error: error.message });

  try {
    return res.json(await pipelineAnalytics(deals));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/analytics/campaigns — CPA/ROI per campaign
router.get('/campaigns', requireRole('manager', 'admin'), async (req, res) => {
  const [{ data: campaigns, error: campaignsError }, { data: deals, error: dealsError }] = await Promise.all([
    fetchAll(() => supabase.from('campaigns').select('*').order('created_at', { ascending: false }).order('id')),
    fetchAll(() => supabase.from('deals').select('*').order('id')),
  ]);
  if (campaignsError) return res.status(400).json({ error: campaignsError.message });
  if (dealsError) return res.status(400).json({ error: dealsError.message });

  const results = campaigns.map((campaign) => ({
    ...campaign,
    cpa: campaignCPA(campaign, deals),
    roi: campaignROI(campaign, deals),
    dealCount: deals.filter((d) => d.campaign_id === campaign.id).length,
  }));

  return res.json({ campaigns: results });
});

// GET /api/analytics/campaigns/me — "View Campaign Results" for a representative:
// how the caller's own deals from each campaign are doing. Budget, CPA and ROI stay manager-only.
router.get('/campaigns/me', async (req, res) => {
  const [{ data: campaigns, error: campaignsError }, { data: deals, error: dealsError }] = await Promise.all([
    fetchAll(() => supabase.from('campaigns').select('id, name, channel, start_date, end_date').order('created_at', { ascending: false }).order('id')),
    fetchAll(() => supabase.from('deals').select('id, campaign_id, stage, value').eq('owner_id', req.user.id).order('id')),
  ]);
  if (campaignsError) return res.status(400).json({ error: campaignsError.message });
  if (dealsError) return res.status(400).json({ error: dealsError.message });

  const results = campaigns.map((campaign) => {
    const mine = deals.filter((d) => d.campaign_id === campaign.id);
    const won = mine.filter((d) => d.stage === 'won');
    const open = mine.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
    return {
      ...campaign,
      dealCount: mine.length,
      wonCount: won.length,
      wonValue: won.reduce((sum, d) => sum + Number(d.value), 0),
      openValue: open.reduce((sum, d) => sum + Number(d.value), 0),
    };
  });

  return res.json({ campaigns: results });
});

export default router;
