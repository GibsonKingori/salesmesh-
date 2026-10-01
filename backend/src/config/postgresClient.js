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

// UTC sessions, like Supabase, so timestamps render identically in both databases
export const pool = connectionString ? new pg.Pool({ connectionString, options: '-c timezone=UTC' }) : null;

// Primary key column for every mirrored table
export const PRIMARY_KEYS = {
  users: 'id',
  contacts: 'id',
  campaigns: 'id',
  deals: 'id',
  activities: 'id',
  funnel_benchmarks: 'transition',
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

// Fire-and-log wrappers used by the routes after a Supabase write succeeds
export async function mirrorUpsert(table, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  try {
    await upsertRows(table, list.filter(Boolean));
  } catch (err) {
    console.error(`[postgres mirror] upsert into ${table} failed — run "npm run db:sync":`, err.message);
  }
}

export async function mirrorDelete(table, rows) {
  const pk = primaryKeyOf(table);
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  try {
    await deleteRows(table, list.map((r) => r[pk]));
  } catch (err) {
    console.error(`[postgres mirror] delete from ${table} failed — run "npm run db:sync":`, err.message);
  }
}
