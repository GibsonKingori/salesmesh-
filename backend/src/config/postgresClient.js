import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Local PostgreSQL mirror. Supabase stays the source of truth: every successful
// Supabase write is replayed here with the same primary keys, so both databases
// hold identical rows. If a mirror write fails the request still succeeds (the
// Supabase write already committed); run `npm run db:sync` to repair drift.

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[postgresClient] DATABASE_URL not set — local PostgreSQL mirroring is disabled');
}

// UTC sessions, like Supabase, so timestamps render identically in both databases.
// Short timeouts: routes await the mirror write, so an unreachable PostgreSQL must fail
// fast (and be healed later) rather than hold up the API response.
export const pool = connectionString
  ? new pg.Pool({
      connectionString,
      options: '-c timezone=UTC',
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    })
  : null;

// Primary key column for every mirrored table
export const PRIMARY_KEYS = {
  companies: 'id',
  users: 'id',
  contacts: 'id',
  campaigns: 'id',
  deals: 'id',
  activities: 'id',
  funnel_benchmarks: 'id',
  audit_logs: 'id',
  password_resets: 'id',
};

const quote = (ident) => `"${ident.replace(/"/g, '""')}"`;

function primaryKeyOf(table) {
  const pk = PRIMARY_KEYS[table];
  if (!pk) throw new Error(`No primary key registered for table "${table}"`);
  return pk;
}

// Insert-or-update full rows (as returned by Supabase) into the local table
export async function upsertRows(table, rows, client = pool) {
  if (!client || !rows?.length) return;
  const pk = primaryKeyOf(table);
  const columns = Object.keys(rows[0]);
  const values = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((col) => {
      values.push(row[col]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  const updates = columns.filter((c) => c !== pk).map((c) => `${quote(c)} = excluded.${quote(c)}`);

  await client.query(
    `insert into ${quote(table)} (${columns.map(quote).join(', ')}) values ${tuples.join(', ')}
     on conflict (${quote(pk)}) ${updates.length ? `do update set ${updates.join(', ')}` : 'do nothing'}`,
    values
  );
}

export async function deleteRows(table, keys, client = pool) {
  if (!client || !keys?.length) return;
  const pk = primaryKeyOf(table);
  await client.query(`delete from ${quote(table)} where ${quote(pk)} = any($1)`, [keys]);
}

// Read by services/mirrorHealer.js: a failed write flags a resync, and the write
// counter lets the healer spot writes that raced a sync in progress.
export const mirrorState = { needsResync: false, writes: 0 };

// An idle pooled connection dropping (PostgreSQL restarted or stopped) is emitted as an
// 'error' event; unhandled, it would crash the whole API. Log it and let the healer resync.
pool?.on('error', (err) => {
  mirrorState.needsResync = true;
  console.error('[postgres mirror] lost connection to local PostgreSQL:', err.message);
});

// Fire-and-log wrappers used by the routes after a Supabase write succeeds
export async function mirrorUpsert(table, rows) {
  if (!pool) return;
  const list = Array.isArray(rows) ? rows : [rows];
  mirrorState.writes++;
  try {
    await upsertRows(table, list.filter(Boolean));
  } catch (err) {
    mirrorState.needsResync = true;
    console.error(`[postgres mirror] upsert into ${table} failed — will resync automatically:`, err.message);
  }
}

export async function mirrorDelete(table, rows) {
  if (!pool) return;
  const pk = primaryKeyOf(table);
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  mirrorState.writes++;
  try {
    await deleteRows(table, list.map((r) => r[pk]));
  } catch (err) {
    mirrorState.needsResync = true;
    console.error(`[postgres mirror] delete from ${table} failed — will resync automatically:`, err.message);
  }
}
