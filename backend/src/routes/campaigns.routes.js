import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert } from '../config/postgresClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { fetchAll } from '../services/fetchAll.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/campaigns — anyone authenticated can view campaigns (deals reference them)
router.get('/', async (req, res) => {
  const { data, error } = await fetchAll(() =>
    supabase.from('campaigns').select('*').order('created_at', { ascending: false }).order('id')
  );
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ campaigns: data });
});

// POST /api/campaigns — manager/admin only: campaigns hold budget data
router.post('/', requireRole('manager', 'admin'), async (req, res) => {
  const { name, budget, start_date, end_date, channel } = req.body;

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
        channel: channel?.trim() || null,
        created_by: req.user.id,
      },
    ])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('campaigns', data);
  await recordAudit(req.user, 'campaign.create', { entity: 'campaign', entityId: data.id, details: { name: data.name, budget: data.budget } });
  return res.status(201).json({ campaign: data });
});

export default router;
