import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { FUNNEL_TRANSITIONS } from '../services/analytics.js';
import { loadBenchmarks } from './analytics.routes.js';
import { recordAudit } from '../services/audit.js';
import { loadPipelineStages, validatePipelineStages } from '../services/pipelineStages.js';
import { loadDealFields, validateDealFields } from '../services/dealFields.js';

const router = express.Router();
router.use(requireAuth);

router.get('/pipeline', async (req, res) => {
  try {
    return res.json({ stages: await loadPipelineStages(supabase, req.user.company_id) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put('/pipeline', requireRole('admin'), async (req, res) => {
  const validated = validatePipelineStages(req.body?.stages);
  if (validated.error) return res.status(400).json({ error: validated.error });

  let current;
  try {
    current = await loadPipelineStages(supabase, req.user.company_id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const removed = current.filter((stage) => !validated.stages.some((next) => next.id === stage.id));
  if (removed.length) {
    const { data: used, error } = await supabase
      .from('deals')
      .select('stage')
      .eq('company_id', req.user.company_id)
      .in('stage', removed.map((stage) => stage.id));
    if (error) return res.status(400).json({ error: error.message });
    if (used.length) {
      const names = [...new Set(used.map((deal) => removed.find((stage) => stage.id === deal.stage)?.label))].join(', ');
      return res.status(400).json({ error: `Move deals out of ${names} before removing those stages.` });
    }
  }

  const { data, error } = await supabase
    .from('companies')
    .update({ pipeline_stages: { stages: validated.stages } })
    .eq('id', req.user.company_id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('companies', data);
  await recordAudit(req.user, 'settings.pipeline_update', { entity: 'settings', details: { stages: validated.stages } });
  return res.json({ stages: validated.stages });
});

router.get('/deal-fields', async (req, res) => {
  try {
    return res.json({ fields: await loadDealFields(supabase, req.user.company_id) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put('/deal-fields', requireRole('admin'), async (req, res) => {
  const validated = validateDealFields(req.body?.fields);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const { data, error } = await supabase
    .from('companies')
    .update({ deal_fields: validated.fields })
    .eq('id', req.user.company_id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('companies', data);
  await recordAudit(req.user, 'settings.deal_fields_update', {
    entity: 'settings',
    details: { fields: validated.fields },
  });
  return res.json({ fields: validated.fields });
});

// System Configuration is an Administrator use case (Chapter 4): managers can read
// the targets, which drive their funnel warnings, but only admins change them.
// GET /api/settings/benchmarks — every transition, with its target rate or null if unset
router.get('/benchmarks', async (req, res) => {
  if (!['manager', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const rates = await loadBenchmarks(req.user.company_id);
    const stages = await loadPipelineStages(supabase, req.user.company_id);
    return res.json({
      benchmarks: FUNNEL_TRANSITIONS(stages).map((transition) => ({ transition, rate: rates[transition] ?? null })),
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
  let transitions;
  try {
    transitions = FUNNEL_TRANSITIONS(await loadPipelineStages(supabase, req.user.company_id));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  for (const [transition, rate] of Object.entries(rates)) {
    if (!transitions.includes(transition)) {
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
    benchmarks: transitions.map((transition) => ({ transition, rate: saved[transition] ?? null })),
  });
});

export default router;
