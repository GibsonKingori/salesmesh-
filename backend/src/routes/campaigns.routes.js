import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/campaigns — anyone authenticated can view campaigns (deals reference them)
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ campaigns: data });
});

// POST /api/campaigns — manager/admin only: campaigns hold budget data
router.post('/', requireRole('manager', 'admin'), async (req, res) => {
  const { name, budget, start_date, end_date } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert([
      {
        name,
        budget: budget != null ? budget : 0,
        start_date: start_date || null,
        end_date: end_date || null,
        created_by: req.user.id,
      },
    ])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ campaign: data });
});

export default router;
