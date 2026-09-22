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
router.use(requireRole('manager', 'admin'));

// GET /api/analytics/pipeline — descriptive + diagnostic + predictive, team-wide
router.get('/pipeline', async (req, res) => {
  const { data: deals, error } = await supabase.from('deals').select('*');
  if (error) return res.status(400).json({ error: error.message });

  return res.json({
    descriptive: descriptiveSummary(deals),
    diagnostic: conversionFunnel(deals),
    predictive: forecastRevenue(deals),
    velocity: pipelineVelocity(deals),
  });
});

// GET /api/analytics/campaigns — CPA/ROI per campaign
router.get('/campaigns', async (req, res) => {
  const [{ data: campaigns, error: campaignsError }, { data: deals, error: dealsError }] = await Promise.all([
    supabase.from('campaigns').select('*'),
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
