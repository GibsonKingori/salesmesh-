import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert } from '../config/postgresClient.js';

// Records one entry for the admin Audit Log. Never throws: a failed audit write is
// logged and the request that triggered it still succeeds.
// actor is { id, name? } (usually req.user) or null for anonymous events such as a failed login.
export async function recordAudit(actor, action, { entity = null, entityId = null, details = null } = {}) {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .insert([
        {
          user_id: actor?.id ?? null,
          user_name: actor?.name ?? actor?.email ?? null,
          action,
          entity,
          entity_id: entityId != null ? String(entityId) : null,
          details,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    await mirrorUpsert('audit_logs', data);
  } catch (err) {
    console.error(`[audit] could not record "${action}":`, err.message);
  }
}
