// Reconciles local PostgreSQL with Supabase (the source of truth). Shared by the
// db:sync / db:verify scripts and the API's background self-healing job.
import { supabase } from '../config/supabaseClient.js';
import { pool, PRIMARY_KEYS, upsertRows, deleteRows } from '../config/postgresClient.js';

// Parents before children so foreign keys resolve on insert
export const TABLES = ['users', 'contacts', 'campaigns', 'deals', 'activities', 'funnel_benchmarks', 'audit_logs', 'password_resets'];
const PAGE = 1000;

async function fetchSupabase(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(PRIMARY_KEYS[table])
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// row_to_json renders values the same way PostgREST does, so rows compare directly
async function fetchPostgres(table, client = pool) {
  const { rows } = await client.query(`select row_to_json(t)::text as j from "${table}" t`);
  return rows.map((r) => JSON.parse(r.j));
}

const canonical = (row) => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));

// Copies every Supabase row into Postgres and removes local rows Supabase no longer has,
// in one transaction. Returns [{ table, synced, removed }].
export async function syncAll() {
  const remote = {};
  for (const table of TABLES) remote[table] = await fetchSupabase(table);

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const table of TABLES) {
      const rows = remote[table];
      for (let i = 0; i < rows.length; i += 500) await upsertRows(table, rows.slice(i, i + 500), client);
    }
    // Children first when removing, so no row is deleted out from under a reference
    const removed = {};
    for (const table of [...TABLES].reverse()) {
      const pk = PRIMARY_KEYS[table];
      const keep = new Set(remote[table].map((r) => String(r[pk])));
      const local = await fetchPostgres(table, client);
      const stale = local.filter((r) => !keep.has(String(r[pk]))).map((r) => r[pk]);
      await deleteRows(table, stale, client);
      removed[table] = stale.length;
    }
    await client.query('commit');
    return TABLES.map((table) => ({ table, synced: remote[table].length, removed: removed[table] }));
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

// Row-by-row comparison. Returns [{ table, supabase, postgres, missing, differing, extra, ok }].
export async function compareAll() {
  const results = [];
  for (const table of TABLES) {
    const pk = PRIMARY_KEYS[table];
    const [remote, local] = await Promise.all([fetchSupabase(table), fetchPostgres(table)]);
    const localByKey = new Map(local.map((r) => [String(r[pk]), canonical(r)]));
    const remoteKeys = new Set(remote.map((r) => String(r[pk])));
    const missing = remote.filter((r) => !localByKey.has(String(r[pk]))).length;
    const differing = remote.filter(
      (r) => localByKey.has(String(r[pk])) && localByKey.get(String(r[pk])) !== canonical(r)
    ).length;
    const extra = local.filter((r) => !remoteKeys.has(String(r[pk]))).length;
    results.push({
      table,
      supabase: remote.length,
      postgres: local.length,
      missing,
      differing,
      extra,
      ok: !missing && !differing && !extra,
    });
  }
  return results;
}
