import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { rankDealsByPriority } from '../services/analytics.js';
import { VALID_STAGES, buildDealUpdate, canEditDeal } from '../services/dealUpdates.js';
import { parseDealQuery, applyDealFilters, matchesDealFilters } from '../services/dealFilters.js';
import { recordAudit } from '../services/audit.js';

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

function scopedDealsQuery(user, { orderBy = 'created_at' } = {}) {
  let query = supabase.from('deals').select('*', { count: 'exact' }).order(orderBy, { ascending: false });
  if (user.role === 'representative') {
    query = query.eq('owner_id', user.id);
  }
  return query;
}

// Reps may only link contacts they own; managers/admins may link any contact
async function contactIsAssignable(user, contactId) {
  if (!contactId || ['manager', 'admin'].includes(user.role)) return true;
  const { data } = await supabase.from('contacts').select('owner_id').eq('id', contactId).maybeSingle();
  return data?.owner_id === user.id;
}

// GET /api/deals — manager sees team deals, rep sees only their own.
// Optional: q (title search), status (open|closed), owner_id, campaign_id, limit + offset.
// Closed deals come most recently updated first, everything else newest first.
router.get('/', async (req, res) => {
  const { filters, page, error: queryError } = parseDealQuery(req.query, req.user);
  if (queryError) return res.status(400).json({ error: queryError });

  let query = applyDealFilters(
    scopedDealsQuery(req.user, { orderBy: filters.status === 'closed' ? 'updated_at' : 'created_at' }),
    filters
  );
  if (page) query = query.range(page.offset, page.offset + page.limit - 1);

  const { data, count, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ deals: data, total: count ?? data.length });
});

// GET /api/deals/priority — open deals ranked by prescriptive priority score.
// Takes the same optional filters and paging as GET /api/deals. Scores are computed over all
// open deals first, so filtering never changes a deal's score.
router.get('/priority', async (req, res) => {
  const { filters, page, error: queryError } = parseDealQuery(req.query, req.user);
  if (queryError) return res.status(400).json({ error: queryError });

  const { data, error } = await scopedDealsQuery(req.user);
  if (error) return res.status(400).json({ error: error.message });

  const ranked = rankDealsByPriority(data).filter((d) => matchesDealFilters(d, filters));
  const deals = page ? ranked.slice(page.offset, page.offset + page.limit) : ranked;
  return res.json({ deals, total: ranked.length });
});

// POST /api/deals — create a deal
router.post('/', async (req, res) => {
  const { title, value, stage, contact_id, campaign_id, expected_close_date } = req.body;

  if (!title || value == null || !stage) {
    return res.status(400).json({ error: 'title, value, and stage are required' });
  }
  if (!(await contactIsAssignable(req.user, contact_id))) {
    return res.status(400).json({ error: 'Contact not found' });
  }

  const { data, error } = await supabase
    .from('deals')
    .insert([
      {
        title,
        value,
        stage,
        contact_id: contact_id || null,
        campaign_id: campaign_id || null,
        expected_close_date: expected_close_date || null,
        owner_id: req.user.id,
      },
    ])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('deals', data);
  await recordAudit(req.user, 'deal.create', { entity: 'deal', entityId: data.id, details: { title: data.title, value: data.value } });
  return res.status(201).json({ deal: data });
});

// POST /api/deals/import — bulk-create deals from a CSV file
// Expected columns: title, value, stage, expected_close_date (optional), owner_email (optional, manager/admin only)
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required (form field name "file")' });
  }

  let records;
  try {
    records = parse(req.file.buffer.toString('utf-8'), {
      columns: (header) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  if (records.length === 0) {
    return res.status(400).json({ error: 'CSV file has no data rows' });
  }

  const canAssignOthers = ['manager', 'admin'].includes(req.user.role);
  const ownerEmails = [...new Set(records.map((r) => r.owner_email).filter(Boolean))];
  let ownerByEmail = {};
  if (ownerEmails.length > 0 && canAssignOthers) {
    const { data: owners } = await supabase.from('users').select('id, email').in('email', ownerEmails);
    ownerByEmail = Object.fromEntries((owners || []).map((u) => [u.email, u.id]));
  }

  const toInsert = [];
  const skipped = [];

  records.forEach((row, idx) => {
    const rowNum = idx + 2; // +2: header row + 1-indexing
    const title = row.title?.trim();
    const stage = row.stage?.trim().toLowerCase();
    const value = Number(row.value);

    if (!title) return skipped.push({ row: rowNum, reason: 'Missing title' });
    if (!VALID_STAGES.includes(stage)) {
      return skipped.push({ row: rowNum, reason: `Invalid stage "${row.stage || ''}"` });
    }
    if (row.value === undefined || row.value === '' || Number.isNaN(value)) {
      return skipped.push({ row: rowNum, reason: 'Missing or invalid value' });
    }

    let owner_id = req.user.id;
    if (row.owner_email) {
      if (!canAssignOthers) {
        return skipped.push({ row: rowNum, reason: 'Only managers/admins can assign owner_email' });
      }
      const matched = ownerByEmail[row.owner_email.trim()];
      if (!matched) return skipped.push({ row: rowNum, reason: `Unknown owner_email "${row.owner_email}"` });
      owner_id = matched;
    }

    toInsert.push({
      title,
      value,
      stage,
      expected_close_date: row.expected_close_date?.trim() || null,
      owner_id,
    });
  });

  if (toInsert.length === 0) {
    return res.status(400).json({ error: 'No valid rows to import', skipped });
  }

  const { data, error } = await supabase.from('deals').insert(toInsert).select();
  if (error) return res.status(400).json({ error: error.message, skipped });
  await mirrorUpsert('deals', data);
  await recordAudit(req.user, 'deal.import', { entity: 'deal', details: { imported: data.length, skipped: skipped.length } });

  return res.status(201).json({ imported: data.length, skipped });
});

// PATCH /api/deals/:id — update a deal (e.g. move stage). Reps may only edit their own
// deals and cannot reassign them; stage moves are logged as stage_change activities.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: existing, error: fetchError } = await supabase
    .from('deals')
    .select('id, owner_id, stage')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  // 404 (not 403) for other reps' deals so IDs can't be probed
  if (!existing || !canEditDeal(req.user, existing)) {
    return res.status(404).json({ error: 'Deal not found' });
  }

  const { updates, error: validationError } = buildDealUpdate(req.body, req.user);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!(await contactIsAssignable(req.user, updates.contact_id))) {
    return res.status(400).json({ error: 'Contact not found' });
  }

  const { data, error } = await supabase
    .from('deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('deals', data);

  if (updates.stage && updates.stage !== existing.stage) {
    const { data: activity, error: activityError } = await supabase.from('activities').insert([
      {
        deal_id: id,
        user_id: req.user.id,
        type: 'stage_change',
        notes: `${existing.stage} → ${updates.stage}`,
      },
    ]).select();
    // The deal update already succeeded; don't fail the request over the log entry
    if (activityError) console.error('Failed to log stage_change activity:', activityError.message);
    else await mirrorUpsert('activities', activity);
  }

  await recordAudit(req.user, 'deal.update', { entity: 'deal', entityId: id, details: { title: data.title, changes: Object.keys(updates) } });
  return res.json({ deal: data });
});

// DELETE /api/deals/:id — remove a deal. Reps may only delete their own deals.
// Its activity log goes with it: activities.deal_id is "on delete cascade" in both databases.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: existing, error: fetchError } = await supabase
    .from('deals')
    .select('id, owner_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!existing || !canEditDeal(req.user, existing)) {
    return res.status(404).json({ error: 'Deal not found' });
  }

  const { data: deleted, error } = await supabase.from('deals').delete().eq('id', id).select('id');
  if (error) return res.status(400).json({ error: error.message });
  await mirrorDelete('deals', deleted);
  await recordAudit(req.user, 'deal.delete', { entity: 'deal', entityId: id });
  return res.status(204).send();
});

export default router;
