import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
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
  const { data: deals, error } = await supabase.from('deals').select('*');
  if (error) return res.status(400).json({ error: error.message });

  try {
    return res.json(await pipelineAnalytics(deals));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/analytics/me — the same analytics, scoped to the caller's own deals
router.get('/me', async (req, res) => {
  const { data: deals, error } = await supabase.from('deals').select('*').eq('owner_id', req.user.id);
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
    supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
    supabase.from('deals').select('*'),
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

export default router;
