import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { canEditDeal } from '../services/dealUpdates.js';

const router = express.Router();
router.use(requireAuth);

// stage_change is written by PATCH /api/deals/:id only, so the stage history can't be forged
const LOGGABLE_TYPES = ['call', 'email', 'meeting', 'note'];

// Returns the deal if the user may see it, otherwise null (callers answer 404 either way)
async function findAccessibleDeal(user, dealId) {
  const { data, error } = await supabase.from('deals').select('id, owner_id').eq('id', dealId).maybeSingle();
  if (error) throw error;
  return data && canEditDeal(user, data) ? data : null;
}

// GET /api/activities?deal_id=... — activity log for a deal
router.get('/', async (req, res) => {
  const { deal_id } = req.query;
  if (!deal_id) {
    return res.status(400).json({ error: 'deal_id query parameter is required' });
  }

  try {
    if (!(await findAccessibleDeal(req.user, deal_id))) return res.status(404).json({ error: 'Deal not found' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('deal_id', deal_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ activities: data });
});

// POST /api/activities — log an activity against a deal
router.post('/', async (req, res) => {
  const { deal_id, type, notes } = req.body;

  if (!deal_id || !type) {
    return res.status(400).json({ error: 'deal_id and type are required' });
  }
  if (!LOGGABLE_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${LOGGABLE_TYPES.join(', ')}` });
  }

  try {
    if (!(await findAccessibleDeal(req.user, deal_id))) return res.status(404).json({ error: 'Deal not found' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { data, error } = await supabase
    .from('activities')
    .insert([{ deal_id, type, notes: notes?.trim() || null, user_id: req.user.id }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('activities', data);
  return res.status(201).json({ activity: data });
});

// DELETE /api/activities/:id — remove a logged activity (correction). Reps can only
// remove entries they wrote; nobody can remove stage_change history.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: activity, error: fetchError } = await supabase
    .from('activities')
    .select('id, deal_id, user_id, type')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return res.status(400).json({ error: fetchError.message });

  const isManager = ['manager', 'admin'].includes(req.user.role);
  if (!activity || (!isManager && activity.user_id !== req.user.id)) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  if (activity.type === 'stage_change') {
    return res.status(400).json({ error: 'Stage history cannot be deleted' });
  }

  const { data: deleted, error } = await supabase.from('activities').delete().eq('id', id).select('id');
  if (error) return res.status(400).json({ error: error.message });
  await mirrorDelete('activities', deleted);
  return res.status(204).send();
});

export default router;
