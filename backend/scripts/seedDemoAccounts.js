// Creates the demo sales team for the Maven Analytics sample dataset (see sample-data/).
// Every agent becomes a Sales Representative and every manager a Manager, with emails like
// moses.frase@maventech.demo and one shared password. Accounts that already exist are left alone.
//
// Usage (from backend/):  DEMO_PASSWORD=... node scripts/seedDemoAccounts.js ../sample-data/maven-sales-teams.csv
import 'dotenv/config';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { supabase } from '../src/config/supabaseClient.js';
import { mirrorUpsert, pool } from '../src/config/postgresClient.js';
import { recordAudit } from '../src/services/audit.js';
import { MIN_PASSWORD_LENGTH } from '../src/routes/auth.routes.js';

export const DEMO_DOMAIN = 'maventech.demo';
const emailFor = (name) => `${name.trim().toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_DOMAIN}`;

async function main() {
  const [file] = process.argv.slice(2);
  const password = process.env.DEMO_PASSWORD;
  if (!file || !password || password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Usage: DEMO_PASSWORD=<at least ${MIN_PASSWORD_LENGTH} chars> node scripts/seedDemoAccounts.js <sales_teams.csv>`);
    process.exit(1);
  }

  const teams = parse(fs.readFileSync(file, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  const people = new Map();
  teams.forEach((t) => {
    people.set(t.manager, 'manager');
    people.set(t.sales_agent, 'representative');
  });

  const emails = [...people.keys()].map(emailFor);
  const { data: existing, error } = await supabase.from('users').select('email').in('email', emails);
  if (error) throw error;
  const taken = new Set(existing.map((u) => u.email));

  const password_hash = await bcrypt.hash(password, 10);
  const toCreate = [...people]
    .filter(([name]) => !taken.has(emailFor(name)))
    .map(([name, role]) => ({ name, email: emailFor(name), role, password_hash }));

  if (toCreate.length) {
    const { data, error: insertError } = await supabase.from('users').insert(toCreate).select();
    if (insertError) throw insertError;
    await mirrorUpsert('users', data);
    for (const u of data) {
      await recordAudit(null, 'auth.register', { entity: 'user', entityId: u.id, details: { role: u.role, seeded: 'maven-demo' } });
    }
  }

  const counts = toCreate.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] || 0) + 1 }), {});
  console.log(`Created ${toCreate.length} demo accounts (${counts.manager || 0} managers, ${counts.representative || 0} reps); ${taken.size} already existed.`);
  await pool?.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
