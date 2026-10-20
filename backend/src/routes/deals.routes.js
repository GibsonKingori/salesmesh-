import express from 'express';
import multer from 'multer';
import { supabase } from '../config/supabaseClient.js';
import { dbErrorMessage } from '../services/dbErrors.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { rankDealsByPriority } from '../services/analytics.js';
import { buildDealUpdate, canEditDeal, closedAtForStageChange } from '../services/dealUpdates.js';
import { parseDealQuery, applyDealFilters, matchesDealFilters } from '../services/dealFilters.js';
import { recordAudit } from '../services/audit.js';
import { fetchAll } from '../services/fetchAll.js';
import { newestFirst, visibleDeals } from '../services/dealCache.js';
import { CLOSED_STAGES, contactKey, dateToTimestamp, parseStage, readDealRow, simplify } from '../services/dealImport.js';
import { buildMapping, parseClientMapping } from '../services/columnMapper.js';
import { VALID_STAGES } from '../services/dealUpdates.js';
import { readImportFile, ReadError } from '../services/importReaders.js';
import { warmUpAi } from '../services/ai.js';
import { canAccessOwned, sameCompany, scopeCompany, scopeOwned, visibleOwnerIds } from '../services/access.js';

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Only the deals the user may see (services/access.js): own deals for a rep, the team's for a
// manager, the whole company's for an admin
function scopedDealsQuery(user, { orderBy = 'created_at' } = {}) {
  // id breaks ties (imported deals often share a date) so paging never repeats or skips a deal
  return scopeOwned(supabase.from('deals').select('*', { count: 'exact' }), user).order(orderBy, { ascending: false }).order('id');
}

// A deal may only link a contact the user can see
async function contactIsAssignable(user, contactId) {
  if (!contactId) return true;
  const { data } = await supabase.from('contacts').select('owner_id, company_id').eq('id', contactId).maybeSingle();
  return canAccessOwned(user, data);
}

// ...and a campaign from the user's own company
async function campaignIsAssignable(user, campaignId) {
  if (!campaignId) return true;
  const { data } = await supabase.from('campaigns').select('company_id').eq('id', campaignId).maybeSingle();
  return sameCompany(user, data);
}

// A manager can hand a deal to themselves or one of their reps; an admin to anyone in the company
async function ownerIsAssignable(user, ownerId) {
  if (!ownerId) return user.role === 'admin';
  const owners = visibleOwnerIds(user);
  if (owners) return owners.includes(ownerId);
  const { data } = await supabase.from('users').select('company_id').eq('id', ownerId).maybeSingle();
  return sameCompany(user, data);
}

async function checkLinks(user, { contact_id, campaign_id }) {
  if (!(await contactIsAssignable(user, contact_id))) return 'Contact not found';
  if (!(await campaignIsAssignable(user, campaign_id))) return 'Campaign not found';
  return null;
}

// GET /api/deals — manager sees team deals, rep sees only their own.
// Optional: q (title search), status (open|closed), owner_id, campaign_id, limit + offset.
// Closed deals come most recently updated first, everything else newest first.
router.get('/', async (req, res) => {
  const { filters, page, error: queryError } = parseDealQuery(req.query, req.user);
  if (queryError) return res.status(400).json({ error: queryError });

  const orderBy = filters.status === 'closed' ? 'updated_at' : 'created_at';
  const buildQuery = () => applyDealFilters(scopedDealsQuery(req.user, { orderBy }), filters);

  if (!page) {
    const { data, error } = await visibleDeals(req.user);
    if (error) return res.status(400).json({ error: error.message });
    const deals = data.filter((d) => matchesDealFilters(d, filters)).sort(newestFirst(orderBy));
    return res.json({ deals, total: deals.length });
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

  const { data, error } = await visibleDeals(req.user);
  if (error) return res.status(400).json({ error: error.message });

  // Newest first before ranking, so deals with equal scores stay newest first
  const ranked = rankDealsByPriority([...data].sort(newestFirst())).filter((d) => matchesDealFilters(d, filters));
  const deals = page ? ranked.slice(page.offset, page.offset + page.limit) : ranked;
  return res.json({ deals, total: ranked.length });
});

// POST /api/deals — create a deal
router.post('/', async (req, res) => {
  const { title, value, stage, contact_id, campaign_id, expected_close_date } = req.body;

  if (!title || value == null || !stage) {
    return res.status(400).json({ error: 'title, value, and stage are required' });
  }
  const linkError = await checkLinks(req.user, { contact_id, campaign_id });
  if (linkError) return res.status(400).json({ error: linkError });

  const { data, error } = await supabase
    .from('deals')
    .insert([
      {
        company_id: req.user.company_id,
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

// POST /api/deals/import — bulk-create deals from the SME's own records (field "file"): CSV or other
// text, Excel/ODS, JSON, or a screenshot/PDF that Claude reads (see services/importReaders.js).
// Any column layout works: known headings are matched directly, the rest by AI
// (services/columnMapper.js), and missing details get defaults the preview reports.
// Optional form fields: mapping (JSON from a previous preview, possibly changed by the user) and
// defaultStage (stage for rows without a status, default "won").
// ?dryRun=1 checks everything and returns the preview without saving.
const IMPORT_CHUNK = 500;
const PARALLEL_INSERTS = 4;

// Saves rows in chunks, a few chunks at a time (each Supabase round trip is slow, so one after
// another made big imports take minutes), and mirrors what was saved. No new chunk is started
// after an error. Returns { saved, error }.
async function insertInChunks(table, rows) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) chunks.push(rows.slice(i, i + IMPORT_CHUNK));
  const saved = [];
  const mirrored = [];
  let error = null;
  let next = 0;
  const worker = async () => {
    while (!error && next < chunks.length) {
      const result = await supabase.from(table).insert(chunks[next++]).select();
      if (result.error) error = result.error;
      else {
        saved.push(...result.data);
        mirrored.push(mirrorUpsert(table, result.data));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_INSERTS, chunks.length) }, worker));
  await Promise.all(mirrored);
  return { saved, error };
}

function statusSummary(table, fields, stageMap, defaultStage) {
  const i = fields.indexOf('stage');
  if (i === -1) return [];
  const counts = new Map();
  table.rows.forEach((r) => {
    const value = String(r.cells[i] ?? '').trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts].map(([value, count]) => {
    const known = stageMap[simplify(value)] ?? parseStage(value);
    return { value, count, stage: known ?? defaultStage, matched: Boolean(known) };
  });
}

// multer errors (e.g. file too big) as a JSON message instead of Express's HTML error page
const uploadFile = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    const error = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big (10 MB maximum)' : err.message;
    return res.status(400).json({ error });
  });

// POST /api/deals/import/warmup?image=1 — the import window calls this when a file is chosen, so a
// local AI model is already loading before the file is checked. Answers at once.
router.post('/import/warmup', (req, res) => {
  warmUpAi({ image: ['1', 'true'].includes(String(req.query.image)) });
  res.status(204).end();
});

router.post('/import', uploadFile, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'A file is required (form field name "file")' });
  }
  const dryRun = ['1', 'true'].includes(String(req.query.dryRun));
  const isManager = ['manager', 'admin'].includes(req.user.role);

  let table;
  try {
    table = await readImportFile(req.file, { includeOwner: isManager });
  } catch (err) {
    if (err instanceof ReadError) return res.status(400).json({ error: err.message });
    console.error('Deal import: could not read file:', err);
    return res.status(500).json({ error: 'Could not read that file' });
  }

  if (table.rows.length === 0) {
    const error = table.readBy === 'ai' ? 'No sales records could be found in that file' : 'The file has no data rows';
    return res.status(400).json({ error, notes: table.notes });
  }

  // Which column holds what: the mapping the user checked in the preview, else work it out
  let mapping = parseClientMapping(req.body?.mapping, table.headers);
  if (!mapping) {
    try {
      mapping = await buildMapping(table);
    } catch (err) {
      console.error('Deal import: column matching failed:', err);
      return res.status(500).json({ error: 'Could not read that file' });
    }
  }
  const fields = mapping.columns;
  // Rows with no status (e.g. a sales book) are completed sales unless the user says otherwise
  const defaultStage = VALID_STAGES.includes(req.body?.defaultStage) ? req.body.defaultStage : 'won';
  const records = table.rows.map(({ line, cells }) => ({
    line,
    raw: Object.fromEntries(fields.flatMap((f, i) => (f ? [[f, cells[i] ?? '']] : []))),
  }));

  const today = new Date().toISOString().slice(0, 10);

  // Look-ups: campaigns by name, owners by email or name, existing contacts by name + company.
  // All limited to what the importer may see: a manager can assign deals to their own reps only.
  const owners = visibleOwnerIds(req.user);
  const usersQuery = () => {
    const q = scopeCompany(supabase.from('users').select('id, name, email'), req.user).order('id');
    return owners ? q.in('id', owners) : q;
  };
  const [campaignsRes, usersRes, contactsRes] = await Promise.all([
    fetchAll(() => scopeCompany(supabase.from('campaigns').select('id, name'), req.user).order('id')),
    isManager ? fetchAll(usersQuery) : Promise.resolve({ data: [] }),
    fetchAll(() => scopeOwned(supabase.from('contacts').select('id, name, company'), req.user).order('id')),
  ]);
  const lookupError = [campaignsRes, usersRes, contactsRes].find((r) => r.error);
  if (lookupError) return res.status(400).json({ error: dbErrorMessage(lookupError.error) });

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
  const fixCounts = {}; // what readDealRow assumed, by kind
  const unknownOwners = new Set();
  const unknownCampaigns = new Set();
  let ownerIgnored = 0;

  records.forEach(({ line: rowNum, raw }) => {
    const { row, fixes, error } = readDealRow(raw, today, { stageMap: mapping.stages, defaultStage, rowNum });
    if (error) return skipped.push({ row: rowNum, reason: error });
    fixes.forEach((f) => (fixCounts[f] = (fixCounts[f] || 0) + 1));

    // An owner or campaign we can't find doesn't stop the deal: it is imported without that link
    let ownerId = req.user.id;
    if (row.owner) {
      if (!isManager) ownerIgnored++;
      else if (ownerByKey.has(row.owner.toLowerCase())) ownerId = ownerByKey.get(row.owner.toLowerCase());
      else unknownOwners.add(row.owner);
    }

    let campaignId = null;
    if (row.campaign) {
      campaignId = campaignByName.get(row.campaign.toLowerCase()) ?? null;
      if (!campaignId) unknownCampaigns.add(row.campaign);
    }

    let contactRef = null;
    if (row.contact_name || row.company) {
      const name = row.contact_name || row.company;
      const key = contactKey(name, row.company);
      if (contactByKey.has(key)) contactRef = { id: contactByKey.get(key) };
      else {
        if (!newContacts.has(key)) {
          newContacts.set(key, {
            company_id: req.user.company_id,
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
        company_id: req.user.company_id,
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

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const list = (set) => [...set].slice(0, 5).map((v) => `"${v}"`).join(', ') + (set.size > 5 ? ` and ${set.size - 5} more` : '');
  const warnings = [];
  const fixed = (kind, message) => fixCounts[kind] && warnings.push(message(fixCounts[kind]));
  fixed('defaultedStage', (n) => `${plural(n, 'deal has', 'deals have')} no status, so ${n === 1 ? 'it' : 'they'} will be imported as "${defaultStage}".`);
  fixed('unknownStage', (n) => `${plural(n, 'deal has a status', 'deals have a status')} we couldn't match, so ${n === 1 ? 'it' : 'they'} will be imported as "${defaultStage}".`);
  fixed('generatedTitle', (n) => `${plural(n, 'deal has', 'deals have')} no name, so one was made from the customer or row (e.g. "Sale – Kamau Builders").`);
  fixed('blankValue', (n) => `${plural(n, 'deal has', 'deals have')} no amount and will be imported as Ksh 0.`);
  fixed('closedFromCreated', (n) => `${plural(n, 'won/lost deal has', 'won/lost deals have')} one date, used as both when it started and when it closed.`);
  fixed('createdAfterClosed', (n) => `${plural(n, 'deal was', 'deals were')} created after ${n === 1 ? 'it' : 'they'} closed; the closed date is used for both.`);
  fixed('badDate', (n) => `${plural(n, 'date', 'dates')} couldn't be read and ${n === 1 ? 'was' : 'were'} left out.`);
  if (closedWithoutDate) {
    warnings.push(`${plural(closedWithoutDate, 'won/lost deal has', 'won/lost deals have')} no closed date, so today will be used. Include the sale dates for an accurate forecast.`);
  }
  if (withoutCreatedDate) {
    warnings.push(`${plural(withoutCreatedDate, 'deal has', 'deals have')} no created date, so today will be used. Include dates for an accurate sales cycle.`);
  }
  if (unknownOwners.size) warnings.push(`No SalesMesh account ${req.user.role === 'manager' ? 'on your team ' : ''}for ${list(unknownOwners)}, so those deals will be assigned to you.`);
  if (ownerIgnored) warnings.push('The salesperson column is ignored: deals you import are assigned to you.');
  if (unknownCampaigns.size) {
    warnings.push(`${unknownCampaigns.size === 1 ? 'Campaign' : 'Campaigns'} ${list(unknownCampaigns)} ${unknownCampaigns.size === 1 ? "doesn't" : "don't"} exist yet, so those deals won't be linked to a campaign. Create ${unknownCampaigns.size === 1 ? 'it' : 'them'} on the Campaigns page first to link them.`);
  }
  const unused = table.headers.filter((h, i) => !fields[i] && table.rows.some((r) => String(r.cells[i] ?? '').trim()));
  if (unused.length) warnings.push(`${plural(unused.length, 'column is', 'columns are')} not used: ${unused.map((h) => `"${h || 'no heading'}"`).join(', ')}.`);

  const summary = {
    rows: records.length,
    imported: deals.length,
    skipped,
    warnings,
    newContacts: newContacts.size,
    totalValue: deals.reduce((s, d) => s + d.deal.value, 0),
    byStage: deals.reduce((acc, d) => ({ ...acc, [d.deal.stage]: (acc[d.deal.stage] || 0) + 1 }), {}),
    recognisedColumns: fields.filter(Boolean),
    // Each of the user's columns and what it was matched to, so the preview can show and change it
    columns: table.headers.map((header, i) => ({ header, field: fields[i] })),
    mapping: { columns: fields, stages: mapping.stages, mappedBy: mapping.mappedBy },
    mappedBy: mapping.mappedBy,
    // Open the column list in the preview when the user should look at it
    checkColumns: mapping.mappedBy !== 'headings' || mapping.notes.length > 0 || !fields.includes('title') || !fields.includes('value'),
    stageColumn: fields.includes('stage'),
    defaultStage,
    defaultedRows: (fixCounts.defaultedStage || 0) + (fixCounts.unknownStage || 0),
    // Each status word in the file and the stage it was read as, so the preview can show and change it
    statuses: statusSummary(table, fields, mapping.stages, defaultStage),
    readBy: table.readBy,
    notes: [...table.notes, ...mapping.notes],
    ...(table.sheet ? { sheet: table.sheet } : {}),
    // Rows read from a picture are sent back so the user can check them, and the browser imports
    // exactly these rows instead of asking Claude to read the picture a second time
    ...(table.readBy === 'ai' ? { extracted: { headers: table.headers, rows: table.rows.map((r) => r.cells) } } : {}),
  };

  if (dryRun || deals.length === 0) {
    if (!dryRun) return res.status(400).json({ error: 'No valid rows to import', ...summary });
    return res.json({ dryRun: true, ...summary, preview: deals.slice(0, 5).map((d) => d.deal) });
  }

  // The import itself is saved first, and every deal and contact it creates points at it, so the
  // whole file can be deleted again from the Deals page. The browser passes the name the user gave
  // it (by default the chosen file's name; a picture is sent back as a CSV with another name).
  const fileName = (String(req.body?.fileName ?? '').trim() || req.file.originalname || '').slice(0, 200) || null;
  const { data: importRow, error: importError } = await supabase
    .from('imports')
    .insert([{ company_id: req.user.company_id, user_id: req.user.id, file_name: fileName }])
    .select()
    .single();
  if (importError) return res.status(400).json({ error: dbErrorMessage(importError), ...summary });
  await mirrorUpsert('imports', importRow);

  // Records what was actually saved; an import that saved nothing is removed again
  const finishImport = async (savedDeals, contactCount) => {
    if (!savedDeals.length && !contactCount) {
      const { data: gone } = await supabase.from('imports').delete().eq('id', importRow.id).select('id');
      await mirrorDelete('imports', gone);
      return;
    }
    const { data } = await supabase
      .from('imports')
      .update({ deal_count: savedDeals.length, contact_count: contactCount, total_value: savedDeals.reduce((s, d) => s + Number(d.value), 0) })
      .eq('id', importRow.id)
      .select();
    await mirrorUpsert('imports', data);
  };

  // Save: new contacts first so deals can point at them, then deals in chunks
  let contactCount = 0;
  if (newContacts.size) {
    const { saved: created, error } = await insertInChunks('contacts', [...newContacts.values()].map((c) => ({ ...c, import_id: importRow.id })));
    contactCount = created.length;
    if (error) {
      await finishImport([], contactCount);
      return res.status(400).json({ error: dbErrorMessage(error), ...summary });
    }
    created.forEach((c) => contactByKey.set(contactKey(c.name, c.company), c.id));
  }
  const rows = deals.map(({ deal, contactRef }) => ({
    ...deal,
    import_id: importRow.id,
    contact_id: contactRef ? contactRef.id ?? contactByKey.get(contactRef.key) ?? null : null,
  }));

  const { saved: savedDeals, error: saveError } = await insertInChunks('deals', rows);
  const saved = savedDeals.length;
  await finishImport(savedDeals, contactCount);
  if (saveError) {
    return res.status(400).json({ error: `Stopped after ${saved} deals: ${dbErrorMessage(saveError)}`, ...summary, imported: saved, importId: importRow.id });
  }

  await recordAudit(req.user, 'deal.import', {
    entity: 'import',
    entityId: importRow.id,
    details: { imported: saved, skipped: skipped.length, newContacts: newContacts.size, totalValue: summary.totalValue, fileName },
  });
  return res.status(201).json({ ...summary, imported: saved, importId: importRow.id });
});

// Imports the user may see, like deals: their own, their team's (manager), or the company's (admin)
const scopedImports = (query, user) => scopeOwned(query, user, 'user_id');
const ID_CHUNK = 200; // ids per .in() filter, so the request URL stays short

// What an import's deals look like, so the user can tell imports apart (older ones have no file
// name): a few example titles, the span of the deals' dates, and how many are open, won and lost
function describeImports(deals) {
  const byImport = new Map();
  deals.forEach((d) => {
    if (!d.import_id) return;
    if (!byImport.has(d.import_id)) byImport.set(d.import_id, []);
    byImport.get(d.import_id).push(d);
  });
  return new Map(
    [...byImport].map(([id, list]) => {
      const sorted = [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1));
      const stages = { open: 0, won: 0, lost: 0 };
      list.forEach((d) => (CLOSED_STAGES.includes(d.stage) ? stages[d.stage]++ : stages.open++));
      return [id, {
        sample_titles: [...new Set(sorted.map((d) => d.title))].slice(0, 3),
        first_deal_at: sorted[0].created_at,
        last_deal_at: sorted[sorted.length - 1].created_at,
        stages,
      }];
    })
  );
}

// GET /api/deals/imports — every import, newest first, with who imported each and what is in it
router.get('/imports', async (req, res) => {
  const [{ data, error }, dealsRes] = await Promise.all([
    fetchAll(() => scopedImports(supabase.from('imports').select('*'), req.user).order('created_at', { ascending: false }).order('id')),
    visibleDeals(req.user),
  ]);
  if (error) return res.status(400).json({ error: dbErrorMessage(error) });
  if (dealsRes.error) return res.status(400).json({ error: dbErrorMessage(dealsRes.error) });
  const contents = describeImports(dealsRes.data);

  const userIds = [...new Set(data.map((i) => i.user_id).filter(Boolean))];
  const { data: users } = userIds.length
    ? await scopeCompany(supabase.from('users').select('id, name'), req.user).in('id', userIds)
    : { data: [] };
  const names = new Map((users ?? []).map((u) => [u.id, u.name]));
  const empty = { sample_titles: [], first_deal_at: null, last_deal_at: null, stages: { open: 0, won: 0, lost: 0 } };
  return res.json({ imports: data.map((i) => ({ ...i, user_name: names.get(i.user_id) ?? null, ...(contents.get(i.id) ?? empty) })) });
});

// PATCH /api/deals/imports/:id — rename an import (body: { name }), e.g. to label one saved before
// file names were recorded. The name is kept in file_name, which the list shows.
router.patch('/imports/:id', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (name.length > 200) return res.status(400).json({ error: 'name must be 200 characters or fewer' });

  const { data: imp, error: fetchError } = await supabase.from('imports').select('*').eq('id', req.params.id).maybeSingle();
  if (fetchError) return res.status(400).json({ error: dbErrorMessage(fetchError) });
  if (!canAccessOwned(req.user, imp, 'user_id')) return res.status(404).json({ error: 'Import not found' });

  const { data, error } = await supabase.from('imports').update({ file_name: name }).eq('id', imp.id).select().single();
  if (error) return res.status(400).json({ error: dbErrorMessage(error) });
  await mirrorUpsert('imports', data);
  await recordAudit(req.user, 'deal.import_rename', { entity: 'import', entityId: imp.id, details: { from: imp.file_name, to: name } });
  return res.json({ import: data });
});

// DELETE /api/deals/imports/:id — removes the deals an import created (their activities go with
// them) and the contacts it created that no remaining deal uses. Only deals the user may still
// see are removed: if some were since given to someone outside a manager's team, the import stays
// listed with those deals until an admin deletes it.
router.delete('/imports/:id', async (req, res) => {
  const { id } = req.params;
  const { data: imp, error: fetchError } = await supabase.from('imports').select('*').eq('id', id).maybeSingle();
  if (fetchError) return res.status(400).json({ error: dbErrorMessage(fetchError) });
  if (!canAccessOwned(req.user, imp, 'user_id')) return res.status(404).json({ error: 'Import not found' });

  const { data: deletedDeals, error: dealsError } = await scopeOwned(supabase.from('deals').delete().eq('import_id', id), req.user).select('id');
  if (dealsError) return res.status(400).json({ error: dbErrorMessage(dealsError) });
  await mirrorDelete('deals', deletedDeals);

  // Contacts it created, minus any that another deal still links to
  const { data: contacts, error: contactsError } = await fetchAll(() =>
    scopeOwned(supabase.from('contacts').select('id').eq('import_id', id), req.user).order('id')
  );
  if (contactsError) return res.status(400).json({ error: dbErrorMessage(contactsError) });
  const contactIds = contacts.map((c) => c.id);
  const inUse = new Set();
  for (let i = 0; i < contactIds.length; i += ID_CHUNK) {
    const chunk = contactIds.slice(i, i + ID_CHUNK);
    const { data, error } = await fetchAll(() =>
      scopeCompany(supabase.from('deals').select('id, contact_id'), req.user).in('contact_id', chunk).order('id')
    );
    if (error) return res.status(400).json({ error: dbErrorMessage(error) });
    data.forEach((d) => inUse.add(d.contact_id));
  }
  const unused = contactIds.filter((cid) => !inUse.has(cid));
  let deletedContacts = 0;
  for (let i = 0; i < unused.length; i += ID_CHUNK) {
    const { data, error } = await supabase.from('contacts').delete().in('id', unused.slice(i, i + ID_CHUNK)).select('id');
    if (error) return res.status(400).json({ error: dbErrorMessage(error) });
    deletedContacts += data.length;
    await mirrorDelete('contacts', data);
  }

  const { count: remaining, error: countError } = await supabase
    .from('deals')
    .select('id', { count: 'exact' })
    .eq('company_id', req.user.company_id)
    .eq('import_id', id)
    .range(0, 0);
  if (countError) return res.status(400).json({ error: dbErrorMessage(countError) });
  if (remaining) {
    const { data } = await supabase.from('imports').update({ deal_count: remaining }).eq('id', id).select();
    await mirrorUpsert('imports', data);
  } else {
    const { data } = await supabase.from('imports').delete().eq('id', id).select('id');
    await mirrorDelete('imports', data);
  }

  await recordAudit(req.user, 'deal.import_delete', {
    entity: 'import',
    entityId: id,
    details: { fileName: imp.file_name, deletedDeals: deletedDeals.length, deletedContacts, remainingDeals: remaining ?? 0 },
  });
  return res.json({ deletedDeals: deletedDeals.length, deletedContacts, remainingDeals: remaining ?? 0 });
});

// PATCH /api/deals/:id — update a deal (e.g. move stage). Reps may only edit their own
// deals and cannot reassign them; managers may reassign within their team; stage moves are logged as stage_change activities.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: existing, error: fetchError } = await supabase
    .from('deals')
    .select('id, owner_id, stage, company_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  // 404 (not 403) for other reps' deals so IDs can't be probed
  if (!existing || !canEditDeal(req.user, existing)) {
    return res.status(404).json({ error: 'Deal not found' });
  }

  const { updates, error: validationError } = buildDealUpdate(req.body, req.user);
  if (validationError) return res.status(400).json({ error: validationError });
  const linkError = await checkLinks(req.user, updates);
  if (linkError) return res.status(400).json({ error: linkError });
  if ('owner_id' in updates && !(await ownerIsAssignable(req.user, updates.owner_id))) {
    return res.status(400).json({ error: req.user.role === 'manager' ? 'You can only assign deals to yourself or your own representatives' : 'That user is not in your company' });
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
    .select('id, owner_id, company_id')
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
