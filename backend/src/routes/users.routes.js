import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert } from '../config/postgresClient.js';
import { requireAuth, requireRole, forgetAccount } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { fetchAll } from '../services/fetchAll.js';
import { scopeCompany, visibleOwnerIds } from '../services/access.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/users/team — names for filters such as "deals owned by": a manager gets
// themselves and their own representatives, an admin everyone in the company
router.get('/team', requireRole('manager', 'admin'), async (req, res) => {
  const owners = visibleOwnerIds(req.user);
  const { data, error } = await fetchAll(() => {
    const query = scopeCompany(supabase.from('users').select('id, name, role, manager_id'), req.user).order('name').order('id');
    return owners ? query.in('id', owners) : query;
  });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ users: data });
});

// Everything below is admin only, and only ever touches the admin's own company
router.use(requireRole('admin'));

const ROLES = ['representative', 'manager', 'admin'];
const PUBLIC_COLUMNS = 'id, name, email, role, is_active, manager_id, created_at';
const publicUser = ({ id, name, email, role, is_active, manager_id, created_at }) => ({
  id,
  name,
  email,
  role,
  is_active,
  manager_id: manager_id ?? null,
  created_at,
});

// A user in the admin's company, or null (answered as 404, so other companies' ids can't be probed)
async function findCompanyUser(admin, id) {
  const { data, error } = await scopeCompany(supabase.from('users').select(PUBLIC_COLUMNS), admin).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// Saves and mirrors changes to several users at once; returns the updated rows
async function updateUsers(admin, ids, changes) {
  if (!ids.length) return [];
  const { data, error } = await scopeCompany(supabase.from('users').update(changes), admin).in('id', ids).select();
  if (error) throw error;
  await mirrorUpsert('users', data);
  return data;
}

// GET /api/users — admin only: everyone in the company, with their role and manager
router.get('/', async (req, res) => {
  const { data, error } = await fetchAll(() => scopeCompany(supabase.from('users').select(PUBLIC_COLUMNS), req.user).order('created_at').order('id'));
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ users: data });
});

// PATCH /api/users/:id/role — admin only: promote or demote a user.
// Admins can't change their own role, so the last admin can't lock everyone out.
// Only representatives have a manager: promoting a rep clears theirs, and demoting a manager
// leaves their reps unassigned until the admin gives them a new one.
router.patch('/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  }
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }

  try {
    const before = await findCompanyUser(req.user, id);
    if (!before) return res.status(404).json({ error: 'User not found' });

    const [data] = await updateUsers(req.user, [id], role === 'representative' ? { role } : { role, manager_id: null });

    let unassigned = [];
    if (before.role === 'manager' && role !== 'manager') {
      const { data: reps, error } = await scopeCompany(supabase.from('users').select('id'), req.user).eq('manager_id', id);
      if (error) throw error;
      unassigned = await updateUsers(req.user, reps.map((r) => r.id), { manager_id: null });
    }

    forgetAccount(id);
    if (before.manager_id) forgetAccount(before.manager_id);
    await recordAudit(req.user, 'user.role_change', {
      entity: 'user',
      entityId: id,
      details: { name: data.name, from: before.role, to: data.role, unassignedReps: unassigned.length || undefined },
    });
    return res.json({ user: publicUser(data), unassigned: unassigned.map(publicUser) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/users/:id/manager — admin only: body { manager_id } (null to unassign).
// Puts a representative in a manager's team; the manager then sees that rep's sales.
router.patch('/:id/manager', async (req, res) => {
  const { id } = req.params;
  const managerId = req.body?.manager_id || null;

  try {
    const rep = await findCompanyUser(req.user, id);
    if (!rep) return res.status(404).json({ error: 'User not found' });
    if (rep.role !== 'representative') {
      return res.status(400).json({ error: 'Only sales representatives are assigned to a manager' });
    }

    let manager = null;
    if (managerId) {
      manager = await findCompanyUser(req.user, managerId);
      if (!manager || manager.role !== 'manager') return res.status(400).json({ error: 'Choose a manager from your company' });
    }

    const [data] = await updateUsers(req.user, [id], { manager_id: managerId });
    // Both managers' cached teams are now out of date
    if (rep.manager_id) forgetAccount(rep.manager_id);
    if (managerId) forgetAccount(managerId);
    forgetAccount(id);

    await recordAudit(req.user, 'user.manager_change', {
      entity: 'user',
      entityId: id,
      details: { name: rep.name, manager: manager?.name ?? null },
    });
    return res.json({ user: publicUser(data) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/users/:id/status — admin only: body { active: true | false }.
// A disabled user can't log in, and any session they have open stops working.
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be true or false' });
  }
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }

  try {
    if (!(await findCompanyUser(req.user, id))) return res.status(404).json({ error: 'User not found' });
    const [data] = await updateUsers(req.user, [id], { is_active: active });

    forgetAccount(id);
    await recordAudit(req.user, active ? 'user.enable' : 'user.disable', { entity: 'user', entityId: id, details: { name: data.name } });
    return res.json({ user: publicUser(data) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
