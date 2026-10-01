import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/contacts — manager/admin see all contacts, rep sees only their own
router.get('/', async (req, res) => {
  let query = supabase.from('contacts').select('*').order('created_at', { ascending: false });

  if (req.user.role === 'representative') {
    query = query.eq('owner_id', req.user.id);
  }

  const { data, error } = await query;
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
  return res.status(201).json({ contact: data });
});

// PATCH /api/contacts/:id — update a contact
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, company, email, phone } = req.body;

  const { data, error } = await supabase
    .from('contacts')
    .update({ name, company, email, phone })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await mirrorUpsert('contacts', data);
  return res.json({ contact: data });
});

// DELETE /api/contacts/:id — remove a contact
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { data: deleted, error } = await supabase.from('contacts').delete().eq('id', id).select('id');
  if (error) return res.status(400).json({ error: error.message });
  // deals.contact_id is "on delete set null" in both databases, so linked deals stay in step
  await mirrorDelete('contacts', deleted);
  return res.status(204).send();
});

export default router;
