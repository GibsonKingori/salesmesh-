import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

// Two companies that must never see each other, and inside Acme two managers who
// must only see their own representatives
process.env.JWT_SECRET = 'test-secret';

const acmeAdmin = { id: 'a-admin', name: 'Ada', email: 'ada@acme.test', role: 'admin', company_id: 'acme' };
const mgr1 = { id: 'a-m1', name: 'Mo', email: 'mo@acme.test', role: 'manager', company_id: 'acme' };
const mgr2 = { id: 'a-m2', name: 'Mia', email: 'mia@acme.test', role: 'manager', company_id: 'acme' };
const rep1 = { id: 'a-r1', name: 'Rae', email: 'rae@acme.test', role: 'representative', company_id: 'acme', manager_id: mgr1.id };
const rep2 = { id: 'a-r2', name: 'Ron', email: 'ron@acme.test', role: 'representative', company_id: 'acme', manager_id: mgr2.id };
const rep3 = { id: 'a-r3', name: 'Ria', email: 'ria@acme.test', role: 'representative', company_id: 'acme' }; // no manager yet
const dukaAdmin = { id: 'd-admin', name: 'Dan', email: 'dan@duka.test', role: 'admin', company_id: 'duka' };
const dukaMgr = { id: 'd-m1', name: 'Dee', email: 'dee@duka.test', role: 'manager', company_id: 'duka' };
const dukaRep = { id: 'd-r1', name: 'Dora', email: 'dora@duka.test', role: 'representative', company_id: 'duka', manager_id: dukaMgr.id };
const everyone = [acmeAdmin, mgr1, mgr2, rep1, rep2, rep3, dukaAdmin, dukaMgr, dukaRep];

let fake;
jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert: jest.fn(), mirrorDelete: jest.fn() }));

const { default: app } = await import('../app.js');

const tokenFor = (user) => `Bearer ${jwt.sign({ id: user.id, email: user.email, role: user.role }, 'test-secret')}`;
const as = (user) => ({
  get: (path) => request(app).get(path).set('Authorization', tokenFor(user)),
  post: (path, body) => request(app).post(path).set('Authorization', tokenFor(user)).send(body),
  patch: (path, body) => request(app).patch(path).set('Authorization', tokenFor(user)).send(body),
  delete: (path) => request(app).delete(path).set('Authorization', tokenFor(user)),
});
const dealIds = (res) => res.body.deals.map((d) => d.id).sort();

const deal = (id, owner, extra = {}) => ({
  id,
  company_id: owner.company_id,
  owner_id: owner.id,
  title: id,
  value: 100,
  stage: 'lead',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
});

beforeEach(() => {
  fake = createFakeSupabase({
    companies: [
      { id: 'acme', name: 'Acme', join_code: 'ACME2345' },
      { id: 'duka', name: 'Duka', join_code: 'DUKA2345' },
    ],
    users: everyone.map((u) => ({ manager_id: null, ...u, password_hash: 'x', is_active: true })),
    deals: [deal('deal-r1', rep1), deal('deal-r2', rep2), deal('deal-r3', rep3), deal('deal-m1', mgr1), deal('deal-duka', dukaRep)],
    contacts: [
      { id: 'c-r1', company_id: 'acme', owner_id: rep1.id, name: 'Wanjiku' },
      { id: 'c-r2', company_id: 'acme', owner_id: rep2.id, name: 'Otieno' },
      { id: 'c-duka', company_id: 'duka', owner_id: dukaRep.id, name: 'Achieng' },
    ],
    campaigns: [
      { id: 'camp-acme', company_id: 'acme', name: 'Acme radio', budget: 1000, created_at: '2026-09-01' },
      { id: 'camp-duka', company_id: 'duka', name: 'Duka SMS', budget: 500, created_at: '2026-09-01' },
    ],
    audit_logs: [
      { id: 'log-acme', company_id: 'acme', action: 'auth.login', user_name: 'Ada', created_at: '2026-09-01T00:00:00Z' },
      { id: 'log-duka', company_id: 'duka', action: 'auth.login', user_name: 'Dan', created_at: '2026-09-01T00:00:00Z' },
    ],
  });
});

describe('companies cannot see each other', () => {
  test("an admin sees every deal in their company and none of another company's", async () => {
    expect(dealIds(await as(acmeAdmin).get('/api/deals'))).toEqual(['deal-m1', 'deal-r1', 'deal-r2', 'deal-r3']);
    expect(dealIds(await as(dukaAdmin).get('/api/deals'))).toEqual(['deal-duka']);
  });

  test("another company's deals, contacts and accounts answer 404, even to its admin", async () => {
    expect((await as(dukaAdmin).patch('/api/deals/deal-r1', { title: 'Hacked' })).status).toBe(404);
    expect((await as(dukaAdmin).delete('/api/deals/deal-r1')).status).toBe(404);
    expect((await as(dukaAdmin).delete('/api/admin/deals/deal-r1')).status).toBe(404);
    expect((await as(dukaAdmin).patch('/api/contacts/c-r1', { name: 'Hacked' })).status).toBe(404);
    expect((await as(dukaAdmin).get(`/api/admin/users/${rep1.id}`)).status).toBe(404);
    expect((await as(dukaAdmin).patch(`/api/users/${rep1.id}/role`, { role: 'admin' })).status).toBe(404);
    expect((await as(dukaAdmin).patch(`/api/users/${rep1.id}/status`, { active: false })).status).toBe(404);
    expect(fake.tables.deals.find((d) => d.id === 'deal-r1').title).toBe('deal-r1');
    expect(fake.tables.users.find((u) => u.id === rep1.id)).toMatchObject({ role: 'representative', is_active: true });
  });

  test('lists of users, campaigns, contacts and audit entries stay inside the company', async () => {
    const users = await as(dukaAdmin).get('/api/users');
    expect(users.body.users.map((u) => u.id).sort()).toEqual([dukaAdmin.id, dukaMgr.id, dukaRep.id].sort());

    const campaigns = await as(dukaRep).get('/api/campaigns');
    expect(campaigns.body.campaigns.map((c) => c.id)).toEqual(['camp-duka']);

    const contacts = await as(dukaAdmin).get('/api/contacts');
    expect(contacts.body.contacts.map((c) => c.id)).toEqual(['c-duka']);

    const audit = await as(dukaAdmin).get('/api/admin/audit');
    expect(audit.body.entries.map((e) => e.id)).toEqual(['log-duka']);

    const overview = await as(dukaAdmin).get('/api/admin/overview');
    expect(overview.body.users.total).toBe(3);
    expect(overview.body.records.deals).toBe(1);
    expect(overview.body.company).toEqual({ id: 'duka', name: 'Duka', joinCode: 'DUKA2345' });
  });

  test("a deal can't be linked to another company's campaign or contact", async () => {
    const base = { title: 'New', value: 10, stage: 'lead' };
    expect((await as(rep1).post('/api/deals', { ...base, campaign_id: 'camp-duka' })).status).toBe(400);
    expect((await as(acmeAdmin).post('/api/deals', { ...base, contact_id: 'c-duka' })).status).toBe(400);

    const ok = await as(rep1).post('/api/deals', { ...base, campaign_id: 'camp-acme' });
    expect(ok.status).toBe(201);
    expect(ok.body.deal).toMatchObject({ company_id: 'acme', owner_id: rep1.id });
  });

  test('conversion targets are set per company', async () => {
    const put = await request(app)
      .put('/api/settings/benchmarks')
      .set('Authorization', tokenFor(acmeAdmin))
      .send({ rates: { 'lead->qualified': 0.4 } });
    expect(put.status).toBe(200);

    const rate = async (user) =>
      (await as(user).get('/api/settings/benchmarks')).body.benchmarks.find((b) => b.transition === 'lead->qualified').rate;
    expect(await rate(mgr1)).toBe(0.4);
    expect(await rate(dukaMgr)).toBeNull();
  });
});

describe('managers only see their own representatives', () => {
  test("each manager's deal list holds their own and their reps' deals only", async () => {
    expect(dealIds(await as(mgr1).get('/api/deals'))).toEqual(['deal-m1', 'deal-r1']);
    expect(dealIds(await as(mgr2).get('/api/deals'))).toEqual(['deal-r2']);
  });

  test("a manager can't open, edit or delete another team's deal", async () => {
    expect((await as(mgr1).patch('/api/deals/deal-r2', { stage: 'won' })).status).toBe(404);
    expect((await as(mgr1).delete('/api/deals/deal-r2')).status).toBe(404);
    expect((await as(mgr1).get('/api/activities?deal_id=deal-r2')).status).toBe(404);
    expect((await as(mgr1).patch('/api/deals/deal-r1', { stage: 'won' })).status).toBe(200);
  });

  test('a manager can only hand deals to themselves or their own reps', async () => {
    expect((await as(mgr1).patch('/api/deals/deal-r1', { owner_id: rep2.id })).status).toBe(400);
    expect((await as(mgr1).patch('/api/deals/deal-r1', { owner_id: dukaRep.id })).status).toBe(400);
    expect((await as(mgr1).patch('/api/deals/deal-m1', { owner_id: rep1.id })).status).toBe(200);
  });

  test('team analytics, contacts and the owner filter list cover the team only', async () => {
    const analytics = await as(mgr1).get('/api/analytics/pipeline');
    expect(analytics.body.descriptive.totalDeals).toBe(2);
    expect(analytics.body.team.map((r) => r.id).sort()).toEqual([mgr1.id, rep1.id].sort());

    const contacts = await as(mgr1).get('/api/contacts');
    expect(contacts.body.contacts.map((c) => c.id)).toEqual(['c-r1']);

    const team = await as(mgr1).get('/api/users/team');
    expect(team.body.users.map((u) => u.id).sort()).toEqual([mgr1.id, rep1.id].sort());
  });

  test("assigning a rep to a manager adds that rep's sales to the manager's view", async () => {
    expect(dealIds(await as(mgr1).get('/api/deals'))).not.toContain('deal-r3');

    const res = await as(acmeAdmin).patch(`/api/users/${rep3.id}/manager`, { manager_id: mgr1.id });
    expect(res.status).toBe(200);
    expect(res.body.user.manager_id).toBe(mgr1.id);
    expect(dealIds(await as(mgr1).get('/api/deals'))).toContain('deal-r3');

    // Moving them to the other manager takes them out of the first one's view
    await as(acmeAdmin).patch(`/api/users/${rep3.id}/manager`, { manager_id: mgr2.id });
    expect(dealIds(await as(mgr1).get('/api/deals'))).not.toContain('deal-r3');
    expect(dealIds(await as(mgr2).get('/api/deals'))).toContain('deal-r3');
  });

  test('only an admin assigns managers, only reps get one, and only a manager from the same company', async () => {
    expect((await as(mgr1).patch(`/api/users/${rep3.id}/manager`, { manager_id: mgr1.id })).status).toBe(403);
    expect((await as(acmeAdmin).patch(`/api/users/${mgr2.id}/manager`, { manager_id: mgr1.id })).status).toBe(400);
    expect((await as(acmeAdmin).patch(`/api/users/${rep3.id}/manager`, { manager_id: rep1.id })).status).toBe(400);
    expect((await as(acmeAdmin).patch(`/api/users/${rep3.id}/manager`, { manager_id: dukaMgr.id })).status).toBe(400);
    expect((await as(dukaAdmin).patch(`/api/users/${rep3.id}/manager`, { manager_id: dukaMgr.id })).status).toBe(404);
  });

  test("demoting a manager leaves their reps unassigned, so nobody else's view changes", async () => {
    const res = await as(acmeAdmin).patch(`/api/users/${mgr1.id}/role`, { role: 'representative' });
    expect(res.status).toBe(200);
    expect(res.body.unassigned.map((u) => u.id)).toEqual([rep1.id]);
    expect(fake.tables.users.find((u) => u.id === rep1.id).manager_id).toBeNull();
    expect(dealIds(await as(mgr2).get('/api/deals'))).toEqual(['deal-r2']);
  });
});
