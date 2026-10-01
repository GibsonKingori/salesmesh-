// Keeps local PostgreSQL identical to Supabase.
//   node scripts/dbSync.js setup   — create the tables in local Postgres (schema.postgres.sql)
//   node scripts/dbSync.js sync    — copy every Supabase row into Postgres and remove local rows Supabase no longer has
//   node scripts/dbSync.js verify  — compare both databases row-by-row; exits 1 on any difference
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { supabase } from '../src/config/supabaseClient.js';
import { pool, PRIMARY_KEYS, upsertRows, deleteRows } from '../src/config/postgresClient.js';

// Parents before children so foreign keys resolve on insert
const TABLES = ['users', 'contacts', 'campaigns', 'deals', 'activities', 'funnel_benchmarks'];
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

// Creates the target database (UTF8, whatever the Windows locale default is) if it doesn't exist
async function ensureDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      'select pg_encoding_to_char(encoding) as enc from pg_database where datname = $1',
      [name]
    );
    if (rows.length === 0) {
      await admin.query(`create database "${name.replace(/"/g, '""')}" encoding 'UTF8' template template0`);
      console.log(`Created database "${name}" (UTF8).`);
    } else if (rows[0].enc !== 'UTF8') {
      throw new Error(
        `Database "${name}" uses ${rows[0].enc}; it must be UTF8 to hold the same text as Supabase (e.g. "→" in stage notes). Drop it and rerun setup.`
      );
    }
  } finally {
    await admin.end();
  }
}

async function setup() {
  await ensureDatabase();
  await pool.query(await readFile(new URL('../schema.postgres.sql', import.meta.url), 'utf-8'));
  console.log('Local PostgreSQL schema is in place.');
}

async function sync() {
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
    for (const table of [...TABLES].reverse()) {
      const pk = PRIMARY_KEYS[table];
      const keep = new Set(remote[table].map((r) => String(r[pk])));
      const local = await fetchPostgres(table, client);
      const stale = local.filter((r) => !keep.has(String(r[pk]))).map((r) => r[pk]);
      await deleteRows(table, stale, client);
      console.log(`${table.padEnd(18)} ${String(remote[table].length).padStart(6)} rows synced, ${stale.length} stale removed`);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function verify() {
  let mismatched = 0;
  for (const table of TABLES) {
    const pk = PRIMARY_KEYS[table];
    const [remote, local] = await Promise.all([fetchSupabase(table), fetchPostgres(table)]);
    const localByKey = new Map(local.map((r) => [String(r[pk]), canonical(r)]));
    const remoteKeys = new Set(remote.map((r) => String(r[pk])));
    const missing = remote.filter((r) => !localByKey.has(String(r[pk]))).length;
    const differing = remote.filter((r) => localByKey.has(String(r[pk])) && localByKey.get(String(r[pk])) !== canonical(r)).length;
    const extra = local.filter((r) => !remoteKeys.has(String(r[pk]))).length;
    const ok = !missing && !differing && !extra;
    if (!ok) mismatched++;
    console.log(
      `${ok ? 'OK  ' : 'DIFF'} ${table.padEnd(18)} supabase=${remote.length} postgres=${local.length}` +
        (ok ? '' : `  (missing locally: ${missing}, different: ${differing}, extra locally: ${extra})`)
    );
  }
  if (mismatched) {
    console.log(`\n${mismatched} table(s) out of sync — run "npm run db:sync".`);
    process.exitCode = 1;
  } else {
    console.log('\nSupabase and local PostgreSQL hold identical data.');
  }
}

const commands = { setup, sync, verify };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`Usage: node scripts/dbSync.js <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
if (!pool) {
  console.error('DATABASE_URL is not set in backend/.env');
  process.exit(1);
}
try {
  await command();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
