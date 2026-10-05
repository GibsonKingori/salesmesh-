import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { FUNNEL_TRANSITIONS } from '../services/analytics.js';
import { loadBenchmarks } from './analytics.routes.js';
import { recordAudit } from '../services/audit.js';

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('manager', 'admin'));

// System Configuration is an Administrator use case (Chapter 4): managers can read
// the targets, which drive their funnel warnings, but only admins change them.
// GET /api/settings/benchmarks — every transition, with its target rate or null if unset
router.get('/benchmarks', async (req, res) => {
  try {
    const rates = await loadBenchmarks(req.user.company_id);
    return res.json({
      benchmarks: FUNNEL_TRANSITIONS.map((transition) => ({ transition, rate: rates[transition] ?? null })),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// PUT /api/settings/benchmarks — body { rates: { 'lead->qualified': 0.5, 'negotiation->won': null } }
// A number (0–1) sets the target; null clears it.
router.put('/benchmarks', requireRole('admin'), async (req, res) => {
  const rates = req.body?.rates;
  if (!rates || typeof rates !== 'object') {
    return res.status(400).json({ error: 'rates object is required' });
  }

  const toUpsert = [];
  const toClear = [];
  for (const [transition, rate] of Object.entries(rates)) {
    if (!FUNNEL_TRANSITIONS.includes(transition)) {
      return res.status(400).json({ error: `Unknown transition "${transition}"` });
    }
    if (rate === null || rate === '') {
      toClear.push(transition);
      continue;
    }
    const n = Number(rate);
    if (Number.isNaN(n) || n < 0 || n > 1) {
      return res.status(400).json({ error: `Rate for ${transition} must be between 0 and 1` });
    }
    toUpsert.push({ company_id: req.user.company_id, transition, rate: n, updated_by: req.user.id, updated_at: new Date().toISOString() });
  }

  if (toUpsert.length > 0) {
    const { data, error } = await supabase
      .from('funnel_benchmarks')
      .upsert(toUpsert, { onConflict: 'company_id,transition' })
      .select();
    if (error) return res.status(400).json({ error: error.message });
    await mirrorUpsert('funnel_benchmarks', data);
  }
  if (toClear.length > 0) {
    const { data, error } = await supabase
      .from('funnel_benchmarks')
      .delete()
      .eq('company_id', req.user.company_id)
      .in('transition', toClear)
      .select('id');
    if (error) return res.status(400).json({ error: error.message });
    await mirrorDelete('funnel_benchmarks', data);
  }

  await recordAudit(req.user, 'settings.benchmarks_update', { entity: 'settings', details: { rates } });
  const saved = await loadBenchmarks(req.user.company_id);
  return res.json({
    benchmarks: FUNNEL_TRANSITIONS.map((transition) => ({ transition, rate: saved[transition] ?? null })),
  });
});

export default router;
