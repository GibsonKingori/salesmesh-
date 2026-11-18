import { supabase } from '../config/supabaseClient.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function replayOfflineCreate(req, res, { table, responseKey, canReplay }) {
  const id = req.get('Idempotency-Key');
  if (!id) return { id: null, handled: false };
  if (!UUID.test(id)) {
    res.status(400).json({ error: 'Idempotency-Key must be a UUID' });
    return { id: null, handled: true };
  }

  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (error) {
    res.status(400).json({ error: error.message });
    return { id: null, handled: true };
  }
  if (!data) return { id, handled: false };
  if (!canReplay(data, req.user)) {
    res.status(409).json({ error: 'This idempotency key is already associated with another record' });
    return { id: null, handled: true };
  }

  res.json({ [responseKey]: data });
  return { id, handled: true };
}
