import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { MIN_PASSWORD_LENGTH } from './auth.routes.js';
import { recordAudit } from '../services/audit.js';
import { fetchAll } from '../services/fetchAll.js';
import { createResetToken, RESET_TOKEN_MINUTES } from '../services/passwordReset.js';
import { VALID_STAGES, closedAtForStageChange } from '../services/dealUpdates.js';

// Administrator use cases from Chapter 4: System Configuration, Audit Log, and looking
// after individual accounts. (Role and enable/disable changes live in users.routes.js.)
const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin'));

const COUNTED_TABLES = ['deals', 'contacts', 'campaigns', 'activities'];
const AUDIT_CATEGORIES = ['auth', 'user', 'deal', 'contact', 'campaign', 'settings'];
const MAX_AUDIT_PAGE = 100;

// Escape ILIKE wildcards so user input is matched literally
const likeLiteral = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const isIsoDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// GET /api/admin/overview — system-wide counts for the admin dashboard
router.get('/overview', async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [users, recentAudit, failedLogins, ...counts] = await Promise.all([
    fetchAll(() => supabase.from('users').select('id, name, email, role, is_active, created_at').order('created_at', { ascending: false }).order('id')),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).range(0, 7),
    supabase.from('audit_logs').select('id', { count: 'exact' }).eq('action', 'auth.login_failed').gte('created_at', since),
    ...COUNTED_TABLES.map((t) => supabase.from(t).select('id', { count: 'exact' })),
  ]);

  const failed = [users, recentAudit, failedLogins, ...counts].find((r) => r.error);
  if (failed) return res.status(400).json({ error: failed.error.message });

  const roleCounts = { admin: 0, manager: 0, representative: 0 };
  users.data.forEach((u) => {
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
  });

  return res.json({
    users: {
      total: users.data.length,
      byRole: roleCounts,
      disabled: users.data.filter((u) => u.is_active === false).length,
      newest: users.data.slice(0, 5),
    },
    records: Object.fromEntries(COUNTED_TABLES.map((t, i) => [t, counts[i].count ?? counts[i].data.length])),
    failedLogins24h: failedLogins.count ?? failedLogins.data.length,
    recentActivity: recentAudit.data,
  });
});

// GET /api/admin/config — read-only view of how the server is set up
router.get('/config', (req, res) => {
  const mirrorStatus = req.app.locals.mirrorStatus;
  return res.json({
    environment: process.env.NODE_ENV || 'development',
    sessionLength: process.env.JWT_EXPIRES_IN || '8h',
    minPasswordLength: MIN_PASSWORD_LENGTH,
    loginRateLimit: '10 attempts per 15 minutes per IP',
    adminSignupEnabled: Boolean(process.env.ADMIN_SIGNUP_CODE),
    passwordResetMinutes: RESET_TOKEN_MINUTES,
    postgresMirror: mirrorStatus ? mirrorStatus() : 'disabled',
  });
});

// GET /api/admin/audit — newest first. All filters are optional:
//   category=deal     one area of the app
//   user_id=…         one person's actions
//   q=wanjiku         part of the name of the person who did it
//   from=…&to=…       ISO timestamps; the page sends the start and end of the chosen day(s)
//   limit=50&offset=0
router.get('/audit', async (req, res) => {
  const { category, user_id: userId, q, from, to } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), MAX_AUDIT_PAGE);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  if (category && !AUDIT_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${AUDIT_CATEGORIES.join(', ')}` });
  }
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    return res.status(400).json({ error: 'from and to must be ISO dates' });
  }

  let query = supabase.from('audit_logs').select('*', { count: 'exact' });
  if (category) query = query.ilike('action', `${category}.%`);
  if (userId) query = query.eq('user_id', userId);
  if (q?.trim()) query = query.ilike('user_name', `%${likeLiteral(q.trim())}%`);
  if (from) query = query.gte('created_at', new Date(from).toISOString());
  if (to) query = query.lt('created_at', new Date(to).toISOString());

  const { data, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ entries: data, total: count ?? data.length, categories: AUDIT_CATEGORIES });
});

// --- One account ------------------------------------------------------------------

async function findUser(id) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, is_active, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// GET /api/admin/users/:id — an account with its deals, campaigns and recent audit entries,
// so an admin can see what someone has and fix it if something goes wrong
router.get('/users/:id', async (req, res) => {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [deals, created, activities, audit] = await Promise.all([
      fetchAll(() => supabase.from('deals').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }).order('id')),
      fetchAll(() => supabase.from('campaigns').select('*').eq('created_by', user.id).order('id')),
      supabase.from('activities').select('id', { count: 'exact' }).eq('user_id', user.id),
      supabase.from('audit_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).range(0, 9),
    ]);
    const failed = [deals, created, activities, audit].find((r) => r.error);
    if (failed) throw failed.error;

    // Campaigns they created, plus campaigns their deals came from
    const createdIds = new Set(created.data.map((c) => c.id));
    const linkedIds = [...new Set(deals.data.map((d) => d.campaign_id).filter((cid) => cid && !createdIds.has(cid)))];
    let linked = [];
    if (linkedIds.length) {
      const { data, error } = await supabase.from('campaigns').select('*').in('id', linkedIds);
      if (error) throw error;
      linked = data;
    }
    const dealsIn = (cid) => deals.data.filter((d) => d.campaign_id === cid).length;
    const campaigns = [
      ...created.data.map((c) => ({ ...c, relation: 'created', dealCount: dealsIn(c.id) })),
      ...linked.map((c) => ({ ...c, relation: 'linked', dealCount: dealsIn(c.id) })),
    ];

    return res.json({
      user,
      deals: deals.data,
      campaigns,
      activityCount: activities.count ?? activities.data.length,
      recentAudit: audit.data,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/deals — add a deal owned by that user
router.post('/users/:id/deals', async (req, res) => {
  const { title, value, stage, expected_close_date, campaign_id } = req.body;
  const amount = Number(value);
  if (!title?.trim() || value === undefined || value === '' || Number.isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: 'title and a value of 0 or more are required' });
  }
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }

  try {
    const owner = await findUser(req.params.id);
    if (!owner) return res.status(404).json({ error: 'User not found' });

    const { data, error } = await supabase
      .from('deals')
      .insert([
        {
          title: title.trim(),
          value: amount,
          stage,
          expected_close_date: expected_close_date || null,
          campaign_id: campaign_id || null,
          owner_id: owner.id,
          closed_at: closedAtForStageChange(null, stage) ?? null,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    await mirrorUpsert('deals', data);
    await recordAudit(req.user, 'deal.create', {
      entity: 'deal',
      entityId: data.id,
      details: { title: data.title, value: data.value, forUser: owner.name, forUserId: owner.id },
    });
    return res.status(201).json({ deal: data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/deals/:id — remove any deal (its activities go with it)
router.delete('/deals/:id', async (req, res) => {
  const { data: deleted, error } = await supabase.from('deals').delete().eq('id', req.params.id).select('id, title, owner_id');
  if (error) return res.status(400).json({ error: error.message });
  if (!deleted.length) return res.status(404).json({ error: 'Deal not found' });

  await mirrorDelete('deals', deleted);
  await recordAudit(req.user, 'deal.delete', {
    entity: 'deal',
    entityId: req.params.id,
    details: { title: deleted[0].title, forUserId: deleted[0].owner_id },
  });
  return res.status(204).send();
});

// POST /api/admin/users/:id/campaigns — add a campaign on that user's behalf
router.post('/users/:id/campaigns', async (req, res) => {
  const { name, budget, start_date, end_date, channel } = req.body;
  const amount = budget === undefined || budget === '' || budget === null ? 0 : Number(budget);
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (Number.isNaN(amount) || amount < 0) return res.status(400).json({ error: 'budget must be 0 or more' });

  try {
    const owner = await findUser(req.params.id);
    if (!owner) return res.status(404).json({ error: 'User not found' });

    const { data, error } = await supabase
      .from('campaigns')
      .insert([
        {
          name: name.trim(),
          budget: amount,
          start_date: start_date || null,
          end_date: end_date || null,
          channel: channel?.trim() || null,
          created_by: owner.id,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    await mirrorUpsert('campaigns', data);
    await recordAudit(req.user, 'campaign.create', {
      entity: 'campaign',
      entityId: data.id,
      details: { name: data.name, budget: data.budget, forUser: owner.name, forUserId: owner.id },
    });
    return res.status(201).json({ campaign: data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/campaigns/:id — deals linked to it are kept and simply lose the link
router.delete('/campaigns/:id', async (req, res) => {
  const { data: existing, error: findError } = await supabase
    .from('campaigns')
    .select('id, name, created_by')
    .eq('id', req.params.id)
    .maybeSingle();
  if (findError) return res.status(400).json({ error: findError.message });
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });

  const { data: unlinked, error: unlinkError } = await supabase
    .from('deals')
    .update({ campaign_id: null })
    .eq('campaign_id', existing.id)
    .select();
  if (unlinkError) return res.status(400).json({ error: unlinkError.message });
  if (unlinked.length) await mirrorUpsert('deals', unlinked);

  const { data: deleted, error } = await supabase.from('campaigns').delete().eq('id', existing.id).select('id');
  if (error) return res.status(400).json({ error: error.message });

  await mirrorDelete('campaigns', deleted);
  await recordAudit(req.user, 'campaign.delete', {
    entity: 'campaign',
    entityId: existing.id,
    details: { name: existing.name, forUserId: existing.created_by, unlinkedDeals: unlinked.length },
  });
  return res.status(204).send();
});

// POST /api/admin/users/:id/reset-link — a single-use password reset link the admin can
// pass on to someone who has forgotten their password
router.post('/users/:id/reset-link', async (req, res) => {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_active === false) {
      return res.status(400).json({ error: 'Enable the account before resetting its password' });
    }

    const { resetPath, expiresAt } = await createResetToken(user.id, req.user.id);
    await recordAudit(req.user, 'user.reset_link', { entity: 'user', entityId: user.id, details: { name: user.name } });
    return res.status(201).json({ resetPath, expiresAt, validMinutes: RESET_TOKEN_MINUTES });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
