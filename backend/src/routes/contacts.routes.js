import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { canEditDeal } from '../services/dealUpdates.js';
import { fetchAll } from '../services/fetchAll.js';
import { recordAudit } from '../services/audit.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/contacts — manager/admin see all contacts, rep sees only their own
router.get('/', async (req, res) => {
  const buildQuery = () => {
    const query = supabase.from('contacts').select('*').order('created_at', { ascending: false }).order('id');
    return req.user.role === 'representative' ? query.eq('owner_id', req.user.id) : query;
  };

  const { data, error } = await fetchAll(buildQuery);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ contacts: data });
});

// POST /api/contacts — create a contact
router.post('/', async (req, res) => {
  const { name, company, email, phone } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert([{ name, company: company || null, email: email || null, phone: phone || null, owner_id: req.user.id }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('contacts', data);
  await recordAudit(req.user, 'contact.create', { entity: 'contact', entityId: data.id, details: { name: data.name } });
  return res.status(201).json({ contact: data });
});

const EDITABLE_FIELDS = ['name', 'company', 'email', 'phone'];

// Returns the contact if the user may change it, otherwise null (callers answer 404 either way,
// so reps can't probe for other reps' contact IDs). Same ownership rule as deals.
async function findEditableContact(user, id) {
  const { data, error } = await supabase.from('contacts').select('id, owner_id').eq('id', id).maybeSingle();
  if (error) throw error;
  return data && canEditDeal(user, data) ? data : null;
}

// PATCH /api/contacts/:id — update a contact. Reps may only edit contacts they own.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field] === '' ? null : req.body[field];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: `Nothing to update — send one of: ${EDITABLE_FIELDS.join(', ')}` });
  }
  if ('name' in updates && !updates.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  try {
    if (!(await findEditableContact(req.user, id))) return res.status(404).json({ error: 'Contact not found' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { data, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('contacts', data);
  await recordAudit(req.user, 'contact.update', { entity: 'contact', entityId: data.id, details: { name: data.name } });
  return res.json({ contact: data });
});

// DELETE /api/contacts/:id — remove a contact. Reps may only delete contacts they own.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (!(await findEditableContact(req.user, id))) return res.status(404).json({ error: 'Contact not found' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { data: deleted, error } = await supabase.from('contacts').delete().eq('id', id).select('id');
  if (error) return res.status(400).json({ error: error.message });
  // deals.contact_id is "on delete set null" in both databases, so linked deals stay in step
  await mirrorDelete('contacts', deleted);
  await recordAudit(req.user, 'contact.delete', { entity: 'contact', entityId: id });
  return res.status(204).send();
});

export default router;
