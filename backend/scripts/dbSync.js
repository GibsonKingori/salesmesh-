// Keeps local PostgreSQL identical to Supabase.
//   node scripts/dbSync.js setup   — create the tables in local Postgres (schema.postgres.sql)
//   node scripts/dbSync.js sync    — copy every Supabase row into Postgres and remove local rows Supabase no longer has
//   node scripts/dbSync.js verify  — compare both databases row-by-row; exits 1 on any difference
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { pool } from '../src/config/postgresClient.js';
import { syncAll, compareAll } from '../src/services/mirrorSync.js';

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
  for (const { table, synced, removed } of await syncAll()) {
    console.log(`${table.padEnd(18)} ${String(synced).padStart(6)} rows synced, ${removed} stale removed`);
  }
}

async function verify() {
  const results = await compareAll();
  for (const r of results) {
    console.log(
      `${r.ok ? 'OK  ' : 'DIFF'} ${r.table.padEnd(18)} supabase=${r.supabase} postgres=${r.postgres}` +
        (r.ok ? '' : `  (missing locally: ${r.missing}, different: ${r.differing}, extra locally: ${r.extra})`)
    );
  }
  const mismatched = results.filter((r) => !r.ok).length;
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
