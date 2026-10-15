// Offline mode. When Supabase can't be reached (no internet), the API reads and writes local
// PostgreSQL instead (config/localSupabase.js) and logs every changed row in offline_changes.
// Once Supabase answers again, those rows are sent to it before anything else is synced, so work
// done offline is never overwritten by the regular Supabase -> local sync (mirrorSync.js).
//
// If a row was changed both offline and in Supabase meanwhile, the offline version wins.
import { pool, PRIMARY_KEYS } from '../config/postgresClient.js';
import { remoteSupabase } from '../config/supabaseClient.js';
import { JOURNAL_TABLE } from '../config/localSupabase.js';
import { dataSource, dataSourceSetting, goOffline, goOnline } from '../config/dataSource.js';
import { TABLES } from './mirrorSync.js';

const CHUNK = 500;

export async function ensureJournal(client = pool) {
  await client.query(`create table if not exists ${JOURNAL_TABLE} (
    seq bigserial primary key,
    table_name text not null,
    row_id text not null,
    op text not null check (op in ('upsert', 'delete')),
    created_at timestamptz not null default now()
  )`);
}

export async function pendingChanges(client = pool) {
  const { rows } = await client.query(`select count(distinct (table_name, row_id))::int as n from ${JOURNAL_TABLE}`);
  return rows[0].n;
}

// Sends every logged change to Supabase: rows that still exist locally are upserted (parents
// first), rows that don't are deleted there (children first). The log is only cleared up to the
// last entry that was sent, so a change made while this runs is sent next time.
// Returns { upserted, deleted }.
export async function pushOfflineChanges({ client = pool, remote = remoteSupabase } = {}) {
  const { rows: logged } = await client.query(
    `select table_name, row_id, max(seq) as seq from ${JOURNAL_TABLE} group by table_name, row_id`
  );
  if (!logged.length) return { upserted: 0, deleted: 0 };
  const upTo = logged.reduce((max, r) => (BigInt(r.seq) > max ? BigInt(r.seq) : max), 0n);

  const idsByTable = new Map();
  logged.forEach((r) => idsByTable.set(r.table_name, [...(idsByTable.get(r.table_name) ?? []), r.row_id]));

  const gone = new Map();
  let upserted = 0;
  for (const table of TABLES) {
    const ids = idsByTable.get(table);
    if (!ids) continue;
    const pk = PRIMARY_KEYS[table];
    const { rows } = await client.query(
      `select row_to_json(t) as j from "${table}" t where t."${pk}"::text = any($1::text[])`,
      [ids]
    );
    let current = rows.map((r) => r.j);
    // users.manager_id points at another user: managers (no manager_id) go first
    if (table === 'users') current = current.sort((a, b) => Boolean(a.manager_id) - Boolean(b.manager_id));
    for (let i = 0; i < current.length; i += CHUNK) {
      const { error } = await remote.from(table).upsert(current.slice(i, i + CHUNK), { onConflict: pk });
      if (error) throw new Error(`Sending offline changes to Supabase (${table}): ${error.message}`);
    }
    upserted += current.length;
    const kept = new Set(current.map((r) => String(r[pk])));
    gone.set(table, ids.filter((id) => !kept.has(id)));
  }

  let deleted = 0;
  for (const table of [...TABLES].reverse()) {
    const ids = gone.get(table) ?? [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await remote.from(table).delete().in(PRIMARY_KEYS[table], ids.slice(i, i + CHUNK));
      if (error) throw new Error(`Sending offline deletions to Supabase (${table}): ${error.message}`);
    }
    deleted += ids.length;
  }

  await client.query(`delete from ${JOURNAL_TABLE} where seq <= $1`, [upTo.toString()]);
  return { upserted, deleted };
}

// Any HTTP answer from Supabase means it can be reached; only a network failure or timeout counts
// as offline. A plain fetch, not the retrying one, so a check never takes long.
export async function supabaseReachable(timeoutMs = 5000) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

// The healer's sync step: offline changes go to Supabase first, then Supabase is copied locally
export function syncWithOfflineChanges(syncAll) {
  return async () => {
    if (dataSource.offline) throw new Error('offline: using the local database until Supabase can be reached');
    const { upserted, deleted } = await pushOfflineChanges();
    if (upserted || deleted) console.log(`[offline] sent offline changes to Supabase: ${upserted} saved, ${deleted} deleted`);
    return syncAll();
  };
}

// Checks every intervalMs whether the API should switch between Supabase and local PostgreSQL.
// Coming back online, the healer's next sync sends the offline changes before anything else.
export function startConnectivityMonitor({ healer, intervalMs = 15_000, reachable = supabaseReachable, log = console }) {
  if (dataSourceSetting() !== 'auto') return { stop() {} };
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const online = await reachable();
      if (!online && goOffline()) {
        log.warn('[offline] Supabase unreachable: using the local PostgreSQL database until the connection is back');
      } else if (online && goOnline()) {
        log.log('[offline] Supabase reachable again: sending offline changes, then resyncing');
        healer?.runSync('back online');
      }
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(check, intervalMs);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}
