import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['call', 'email', 'meeting', 'note', 'stage_change'];

// GET /api/activities?deal_id=... — activity log for a deal
router.get('/', async (req, res) => {
  const { deal_id } = req.query;
  if (!deal_id) {
    return res.status(400).json({ error: 'deal_id query parameter is required' });
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
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }

  const { data, error } = await supabase
    .from('activities')
    .insert([{ deal_id, type, notes: notes || null, user_id: req.user.id }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ activity: data });
});

// DELETE /api/activities/:id — remove a logged activity (correction)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

export default router;
