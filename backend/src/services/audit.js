import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert } from '../config/postgresClient.js';

// Records one entry for the admin Audit Log. Never throws: a failed audit write is
// logged and the request that triggered it still succeeds.
// actor is { id, name?, company_id } (usually req.user) or null for anonymous events such as a
// failed login. The entry belongs to the actor's company (or companyId, for anonymous events
// that still concern one company); only that company's admins see it.
export async function recordAudit(actor, action, { entity = null, entityId = null, details = null, companyId = null } = {}) {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .insert([
        {
          company_id: actor?.company_id ?? companyId,
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
