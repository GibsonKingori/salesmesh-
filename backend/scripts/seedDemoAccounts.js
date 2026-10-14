// Creates the demo sales team for the Maven Analytics sample dataset (see sample-data/) inside an
// existing company: start one on the Register page, then pass its join code (shown on the admin
// overview). Every agent becomes a Sales Representative assigned to their manager, and every
// manager a Manager, with emails like moses.frase@maventech.demo and one shared password.
// Accounts that already exist are left alone.
//
// Usage (from backend/):
//   DEMO_PASSWORD=... DEMO_JOIN_CODE=... node scripts/seedDemoAccounts.js ../sample-data/maven-sales-teams.csv
import 'dotenv/config';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { supabase } from '../src/config/supabaseClient.js';
import { mirrorUpsert, pool } from '../src/config/postgresClient.js';
import { recordAudit } from '../src/services/audit.js';
import { findCompanyByJoinCode } from '../src/services/companies.js';
import { MIN_PASSWORD_LENGTH } from '../src/routes/auth.routes.js';

export const DEMO_DOMAIN = 'maventech.demo';
const emailFor = (name) => `${name.trim().toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_DOMAIN}`;

async function main() {
  const [file] = process.argv.slice(2);
  const password = process.env.DEMO_PASSWORD;
  if (!file || !password || password.length < MIN_PASSWORD_LENGTH || !process.env.DEMO_JOIN_CODE) {
    console.error(
      `Usage: DEMO_PASSWORD=<at least ${MIN_PASSWORD_LENGTH} chars> DEMO_JOIN_CODE=<your company's join code> node scripts/seedDemoAccounts.js <sales_teams.csv>`
    );
    process.exit(1);
  }
  const company = await findCompanyByJoinCode(process.env.DEMO_JOIN_CODE);
  if (!company) throw new Error('No company has that join code. Copy it from the admin overview.');

  const teams = parse(fs.readFileSync(file, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  const managerOf = new Map(teams.map((t) => [t.sales_agent, t.manager]));
  const managers = [...new Set(teams.map((t) => t.manager))];

  const emails = [...managers, ...managerOf.keys()].map(emailFor);
  const { data: existing, error } = await supabase.from('users').select('id, email').in('email', emails);
  if (error) throw error;
  const idByEmail = new Map(existing.map((u) => [u.email, u.id]));
  const password_hash = await bcrypt.hash(password, 10);

  // Managers first, so each new rep can be assigned to theirs
  const insert = async (rows) => {
    if (!rows.length) return [];
    const { data, error: insertError } = await supabase.from('users').insert(rows).select();
    if (insertError) throw insertError;
    await mirrorUpsert('users', data);
    for (const u of data) {
      idByEmail.set(u.email, u.id);
      await recordAudit(null, 'auth.register', {
        entity: 'user',
        entityId: u.id,
        companyId: company.id,
        details: { role: u.role, seeded: 'maven-demo' },
      });
    }
    return data;
  };
  const newUser = (name, role, extra = {}) => ({ name, email: emailFor(name), role, password_hash, company_id: company.id, ...extra });

  const createdManagers = await insert(
    managers.filter((m) => !idByEmail.has(emailFor(m))).map((m) => newUser(m, 'manager'))
  );
  const createdReps = await insert(
    [...managerOf]
      .filter(([rep]) => !idByEmail.has(emailFor(rep)))
      .map(([rep, manager]) => newUser(rep, 'representative', { manager_id: idByEmail.get(emailFor(manager)) }))
  );

  const created = createdManagers.length + createdReps.length;
  console.log(
    `Created ${created} demo accounts in ${company.name} (${createdManagers.length} managers, ${createdReps.length} reps); ` +
      `${emails.length - created} already existed.`
  );
  await pool?.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
