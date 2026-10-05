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
  teamPerformance,
  dealsNeedingAttention,
} from '../services/analytics.js';
import { scopeCompany, scopeOwned, visibleOwnerIds } from '../services/access.js';

const router = express.Router();
router.use(requireAuth);

const RECENT_ACTIVITY_COUNT = 8;

// The company's target rates (set by its admin), as { 'lead->qualified': 0.5, ... }
export async function loadBenchmarks(companyId) {
  const { data, error } = await supabase.from('funnel_benchmarks').select('transition, rate').eq('company_id', companyId);
  if (error) throw error;
  return Object.fromEntries(data.map((b) => [b.transition, Number(b.rate)]));
}

async function pipelineAnalytics(deals, companyId) {
  return {
    descriptive: descriptiveSummary(deals),
    diagnostic: conversionFunnel(deals, await loadBenchmarks(companyId)),
    predictive: forecastRevenue(deals),
    velocity: pipelineVelocity(deals),
  };
}

// The people whose numbers the user may see: a manager's team (and themselves), or for an
// admin everyone in the company
function scopedUsersQuery(user) {
  const query = scopeCompany(supabase.from('users').select('id, name, role'), user).order('name').order('id');
  const owners = visibleOwnerIds(user);
  return owners ? query.in('id', owners) : query;
}

// GET /api/analytics/pipeline — descriptive + diagnostic + predictive for a manager's team
// (or an admin's whole company), plus a per-rep performance breakdown for the manager dashboard
router.get('/pipeline', requireRole('manager', 'admin'), async (req, res) => {
  const [{ data: deals, error }, { data: users, error: usersError }] = await Promise.all([
    fetchAll(() => scopeOwned(supabase.from('deals').select('*'), req.user).order('id')),
    fetchAll(() => scopedUsersQuery(req.user)),
  ]);
  if (error) return res.status(400).json({ error: error.message });
  if (usersError) return res.status(400).json({ error: usersError.message });

  try {
    return res.json({ ...(await pipelineAnalytics(deals, req.user.company_id)), team: teamPerformance(deals, users) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/analytics/me — the same analytics, scoped to the caller's own deals, plus what the
// rep dashboard needs: deals overdue or closing soon, and the caller's latest logged activities
router.get('/me', async (req, res) => {
  const [{ data: deals, error }, { data: activities, error: activitiesError }] = await Promise.all([
    fetchAll(() => supabase.from('deals').select('*').eq('company_id', req.user.company_id).eq('owner_id', req.user.id).order('id')),
    supabase
      .from('activities')
      .select('id, type, notes, created_at, deal_id, deals(title)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(RECENT_ACTIVITY_COUNT),
  ]);
  if (error) return res.status(400).json({ error: error.message });
  if (activitiesError) return res.status(400).json({ error: activitiesError.message });

  try {
    return res.json({
      ...(await pipelineAnalytics(deals, req.user.company_id)),
      attention: dealsNeedingAttention(deals),
      recentActivities: activities.map(({ deals: deal, ...a }) => ({ ...a, deal_title: deal?.title ?? null })),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/analytics/campaigns — CPA/ROI per company campaign, counting the deals the user
// may see (a manager's team, or the whole company for an admin)
router.get('/campaigns', requireRole('manager', 'admin'), async (req, res) => {
  const [{ data: campaigns, error: campaignsError }, { data: deals, error: dealsError }] = await Promise.all([
    fetchAll(() => scopeCompany(supabase.from('campaigns').select('*'), req.user).order('created_at', { ascending: false }).order('id')),
    fetchAll(() => scopeOwned(supabase.from('deals').select('*'), req.user).order('id')),
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
    fetchAll(() =>
      scopeCompany(supabase.from('campaigns').select('id, name, channel, start_date, end_date'), req.user)
        .order('created_at', { ascending: false })
        .order('id')
    ),
    fetchAll(() =>
      supabase.from('deals').select('id, campaign_id, stage, value').eq('company_id', req.user.company_id).eq('owner_id', req.user.id).order('id')
    ),
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
