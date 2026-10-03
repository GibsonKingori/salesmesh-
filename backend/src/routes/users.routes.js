import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert } from '../config/postgresClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/users/team — managers and admins: names for filters such as "deals owned by"
router.get('/team', requireRole('manager', 'admin'), async (req, res) => {
  const { data, error } = await supabase.from('users').select('id, name, role').order('name');
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ users: data });
});

// Everything below is admin only
router.use(requireRole('admin'));

const ROLES = ['representative', 'manager', 'admin'];
const PUBLIC_COLUMNS = 'id, name, email, role, created_at';

// GET /api/users — admin only: everyone who can sign in, with their role
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('users').select(PUBLIC_COLUMNS).order('created_at');
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ users: data });
});

// PATCH /api/users/:id/role — admin only: promote or demote a user.
// Admins can't change their own role, so the last admin can't lock everyone out.
// The user's existing token keeps its old role until they sign in again (max JWT_EXPIRES_IN).
router.patch('/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  }
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }

  const { data, error } = await supabase.from('users').update({ role }).eq('id', id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });

  await mirrorUpsert('users', data);
  const { id: savedId, name, email, role: savedRole, created_at } = data;
  return res.json({ user: { id: savedId, name, email, role: savedRole, created_at } });
});

export default router;
