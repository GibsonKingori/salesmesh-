import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { rankDealsByPriority } from '../services/analytics.js';
import { buildDealUpdate, canEditDeal, closedAtForStageChange } from '../services/dealUpdates.js';
import { parseDealQuery, applyDealFilters, matchesDealFilters } from '../services/dealFilters.js';
import { recordAudit } from '../services/audit.js';
import { fetchAll } from '../services/fetchAll.js';
import { CLOSED_STAGES, contactKey, dateToTimestamp, mapHeaders, readDealRow } from '../services/dealImport.js';

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function scopedDealsQuery(user, { orderBy = 'created_at' } = {}) {
  // id breaks ties (imported deals often share a date) so paging never repeats or skips a deal
  let query = supabase.from('deals').select('*', { count: 'exact' }).order(orderBy, { ascending: false }).order('id');
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

  const buildQuery = () =>
    applyDealFilters(scopedDealsQuery(req.user, { orderBy: filters.status === 'closed' ? 'updated_at' : 'created_at' }), filters);

  if (!page) {
    const { data, error } = await fetchAll(buildQuery);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ deals: data, total: data.length });
  }

  const { data, count, error } = await buildQuery().range(page.offset, page.offset + page.limit - 1);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ deals: data, total: count ?? data.length });
});

// GET /api/deals/priority — open deals ranked by prescriptive priority score.
// Takes the same optional filters and paging as GET /api/deals. Scores are computed over all
// open deals first, so filtering never changes a deal's score.
router.get('/priority', async (req, res) => {
  const { filters, page, error: queryError } = parseDealQuery(req.query, req.user);
  if (queryError) return res.status(400).json({ error: queryError });

  const { data, error } = await fetchAll(() => scopedDealsQuery(req.user));
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
        closed_at: closedAtForStageChange(null, stage) ?? null,
      },
    ])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('deals', data);
  await recordAudit(req.user, 'deal.create', { entity: 'deal', entityId: data.id, details: { title: data.title, value: data.value } });
  return res.status(201).json({ deal: data });
});

// POST /api/deals/import — bulk-create deals from the SME's own records (CSV, field "file").
// Columns (common alternatives accepted, see services/dealImport.js):
//   required: title, value, stage
//   optional: created_date, closed_date, expected_close_date, campaign, contact_name, company,
//             contact_email, contact_phone, owner (manager/admin only: email or full name)
// ?dryRun=1 checks everything and returns the preview without saving.
const IMPORT_CHUNK = 500;

router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required (form field name "file")' });
  }
  const dryRun = ['1', 'true'].includes(String(req.query.dryRun));

  let records;
  let fields;
  try {
    // Strip a UTF-8 BOM (Excel adds one) so the first header is recognised
    const text = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
    records = parse(text, {
      columns: (header) => {
        fields = mapHeaders(header);
        return header.map((h, i) => fields[i] ?? `__ignored_${i}`);
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not read the CSV: ${err.message}` });
  }

  if (records.length === 0) {
    return res.status(400).json({ error: 'The CSV file has no data rows' });
  }
  const missing = ['title', 'value', 'stage'].filter((f) => !fields.includes(f));
  if (missing.length) {
    return res.status(400).json({
      error: `Missing required column(s): ${missing.join(', ')}. Download the template to see the expected headings.`,
    });
  }

  const isManager = ['manager', 'admin'].includes(req.user.role);
  const today = new Date().toISOString().slice(0, 10);

  // Look-ups: campaigns by name, owners by email or name, existing contacts by name + company
  const contactsQuery = () => {
    const q = supabase.from('contacts').select('id, name, company').order('id');
    return isManager ? q : q.eq('owner_id', req.user.id);
  };
  const [campaignsRes, usersRes, contactsRes] = await Promise.all([
    fetchAll(() => supabase.from('campaigns').select('id, name').order('id')),
    isManager ? fetchAll(() => supabase.from('users').select('id, name, email').order('id')) : Promise.resolve({ data: [] }),
    fetchAll(contactsQuery),
  ]);
  const lookupError = [campaignsRes, usersRes, contactsRes].find((r) => r.error);
  if (lookupError) return res.status(400).json({ error: lookupError.error.message });

  const campaignByName = new Map(campaignsRes.data.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const ownerByKey = new Map();
  usersRes.data.forEach((u) => {
    ownerByKey.set(u.email.toLowerCase(), u.id);
    ownerByKey.set(u.name.trim().toLowerCase(), u.id);
  });
  const contactByKey = new Map(contactsRes.data.map((c) => [contactKey(c.name, c.company), c.id]));

  const deals = [];
  const skipped = [];
  const newContacts = new Map(); // key -> contact row to create
  let closedWithoutDate = 0;
  let withoutCreatedDate = 0;

  records.forEach((raw, idx) => {
    const rowNum = idx + 2; // +2: header row + 1-indexing
    const { row, error } = readDealRow(raw, today);
    if (error) return skipped.push({ row: rowNum, reason: error });

    let ownerId = req.user.id;
    if (row.owner) {
      if (!isManager) return skipped.push({ row: rowNum, reason: 'Only managers and admins can set the owner' });
      ownerId = ownerByKey.get(row.owner.toLowerCase());
      if (!ownerId) return skipped.push({ row: rowNum, reason: `No SalesMesh account for owner "${row.owner}"` });
    }

    let campaignId = null;
    if (row.campaign) {
      campaignId = campaignByName.get(row.campaign.toLowerCase());
      if (!campaignId) {
        return skipped.push({ row: rowNum, reason: `Unknown campaign "${row.campaign}" — create it on the Campaigns page first` });
      }
    }

    let contactRef = null;
    if (row.contact_name || row.company) {
      const name = row.contact_name || row.company;
      const key = contactKey(name, row.company);
      if (contactByKey.has(key)) contactRef = { id: contactByKey.get(key) };
      else {
        if (!newContacts.has(key)) {
          newContacts.set(key, {
            name,
            company: row.company || null,
            email: row.contact_email || null,
            phone: row.contact_phone || null,
            owner_id: ownerId,
          });
        }
        contactRef = { key };
      }
    }

    const closed = CLOSED_STAGES.includes(row.stage);
    if (closed && !row.closed_date) closedWithoutDate++;
    if (!row.created_date) withoutCreatedDate++;

    const createdAt = row.created_date ? dateToTimestamp(row.created_date) : new Date().toISOString();
    // Closed deals with no date close "now", but never before they were created
    const closedAt = closed ? (row.closed_date ? dateToTimestamp(row.closed_date) : new Date().toISOString()) : null;

    deals.push({
      rowNum,
      contactRef,
      deal: {
        title: row.title,
        value: row.value,
        stage: row.stage,
        expected_close_date: row.expected_close_date || null,
        campaign_id: campaignId,
        owner_id: ownerId,
        created_at: createdAt,
        updated_at: closedAt || createdAt,
        closed_at: closedAt,
      },
    });
  });

  const warnings = [];
  if (closedWithoutDate) {
    warnings.push(
      `${closedWithoutDate} won/lost deal${closedWithoutDate === 1 ? ' has' : 's have'} no closed date, so today will be used. Add a closed_date column for an accurate forecast.`
    );
  }
  if (withoutCreatedDate) {
    warnings.push(
      `${withoutCreatedDate} deal${withoutCreatedDate === 1 ? ' has' : 's have'} no created date, so today will be used. Add a created_date column for an accurate sales cycle.`
    );
  }
  const ignored = fields.filter((f) => f === null).length;
  if (ignored) warnings.push(`${ignored} column${ignored === 1 ? ' was' : 's were'} not recognised and will be ignored.`);

  const summary = {
    rows: records.length,
    imported: deals.length,
    skipped,
    warnings,
    newContacts: newContacts.size,
    totalValue: deals.reduce((s, d) => s + d.deal.value, 0),
    byStage: deals.reduce((acc, d) => ({ ...acc, [d.deal.stage]: (acc[d.deal.stage] || 0) + 1 }), {}),
    recognisedColumns: fields.filter(Boolean),
  };

  if (dryRun || deals.length === 0) {
    if (!dryRun) return res.status(400).json({ error: 'No valid rows to import', ...summary });
    return res.json({ dryRun: true, ...summary, preview: deals.slice(0, 5).map((d) => d.deal) });
  }

  // Save: new contacts first so deals can point at them, then deals in chunks
  if (newContacts.size) {
    const { data: created, error } = await supabase.from('contacts').insert([...newContacts.values()]).select();
    if (error) return res.status(400).json({ error: error.message, ...summary });
    await mirrorUpsert('contacts', created);
    created.forEach((c) => contactByKey.set(contactKey(c.name, c.company), c.id));
  }
  const rows = deals.map(({ deal, contactRef }) => ({
    ...deal,
    contact_id: contactRef ? contactRef.id ?? contactByKey.get(contactRef.key) ?? null : null,
  }));

  let saved = 0;
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
    const { data, error } = await supabase.from('deals').insert(rows.slice(i, i + IMPORT_CHUNK)).select();
    if (error) {
      return res.status(400).json({ error: `Stopped after ${saved} deals: ${error.message}`, ...summary, imported: saved });
    }
    await mirrorUpsert('deals', data);
    saved += data.length;
  }

  await recordAudit(req.user, 'deal.import', {
    entity: 'deal',
    details: { imported: saved, skipped: skipped.length, newContacts: newContacts.size, totalValue: summary.totalValue },
  });
  return res.status(201).json({ ...summary, imported: saved });
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
  const closedAt = closedAtForStageChange(existing.stage, updates.stage);
  if (closedAt !== undefined) updates.closed_at = closedAt;

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
