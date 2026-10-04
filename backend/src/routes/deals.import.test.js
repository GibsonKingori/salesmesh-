import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

process.env.JWT_SECRET = 'test-secret';

const manager = { id: 'mgr-1', name: 'Mo Otieno', email: 'mo@example.com', role: 'manager' };
const rep = { id: 'rep-1', name: 'Rae Wanjiku', email: 'rae@example.com', role: 'representative' };

let fake;
const mirrorUpsert = jest.fn();
const mirrorDelete = jest.fn();

jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert, mirrorDelete }));

const { default: app } = await import('../app.js');

const tokenFor = (user) => `Bearer ${jwt.sign({ id: user.id, email: user.email, role: user.role }, 'test-secret')}`;
const upload = (user, csv, query = {}) =>
  request(app)
    .post('/api/deals/import')
    .query(query)
    .set('Authorization', tokenFor(user))
    .attach('file', Buffer.from(csv, 'utf-8'), 'deals.csv');

beforeEach(() => {
  fake = createFakeSupabase({
    users: [manager, rep].map((u) => ({ ...u, password_hash: 'x', is_active: true })),
    campaigns: [{ id: 'camp-radio', name: 'Radio Citizen Q1', budget: 50000 }],
    contacts: [{ id: 'c-1', name: 'Jane Achieng', company: 'Achieng Hardware', owner_id: rep.id }],
    deals: [],
  });
  mirrorUpsert.mockClear();
});

const SME_EXPORT = [
  '﻿Deal Name,Amount (KES),Status,Date Created,Date Won,Customer,Company,Phone,Campaign,Sales Rep,Notes',
  'Shop shelving,"KES 120,000",Closed Won,02/03/2026,20/03/2026,Jane Achieng,Achieng Hardware,,radio citizen q1,Rae Wanjiku,repeat buyer',
  'Bulk cement,450000,Quote sent,15/09/2026,,Peter Kamau,Kamau Builders,0712345678,,rae@example.com,',
  'Roofing,90000,Lost,01/04/2026,10/04/2026,Peter Kamau,Kamau Builders,,,Mo Otieno,',
  'Tiles,30000,Won,,,,,,,,',
  'Paint,abc,Won,,,,,,,,',
  'Doors,5000,lead,,,,,,Facebook Ads,,',
].join('\n');

describe('POST /api/deals/import', () => {
  test('a dry run reports exactly what would happen and saves nothing', async () => {
    const res = await upload(manager, SME_EXPORT, { dryRun: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, rows: 6, imported: 4, newContacts: 1, totalValue: 690000 });
    expect(res.body.byStage).toEqual({ won: 2, proposal: 1, lost: 1 });
    expect(res.body.skipped).toEqual([
      { row: 6, reason: 'Invalid value "abc"' },
      { row: 7, reason: expect.stringContaining('Unknown campaign "Facebook Ads"') },
    ]);
    expect(res.body.warnings.join(' ')).toMatch(/1 won\/lost deal has no closed date/);
    expect(res.body.warnings.join(' ')).toMatch(/1 column was not recognised/);
    expect(fake.tables.deals).toHaveLength(0);
    expect(fake.tables.contacts).toHaveLength(1);
  });

  test('keeps the real dates, links campaigns, owners and contacts', async () => {
    const res = await upload(manager, SME_EXPORT);
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(4);

    const byTitle = Object.fromEntries(fake.tables.deals.map((d) => [d.title, d]));
    expect(byTitle['Shop shelving']).toMatchObject({
      value: 120000,
      stage: 'won',
      owner_id: rep.id,
      campaign_id: 'camp-radio',
      contact_id: 'c-1',
      created_at: '2026-03-02T09:00:00.000Z',
      closed_at: '2026-03-20T09:00:00.000Z',
    });
    expect(byTitle['Bulk cement']).toMatchObject({ stage: 'proposal', owner_id: rep.id, closed_at: null });
    expect(byTitle.Roofing).toMatchObject({ stage: 'lost', owner_id: manager.id });

    // Peter Kamau appears twice but is created once, and both deals point at him
    const kamau = fake.tables.contacts.filter((c) => c.name === 'Peter Kamau');
    expect(kamau).toHaveLength(1);
    expect(byTitle['Bulk cement'].contact_id).toBe(kamau[0].id);
    expect(byTitle.Roofing.contact_id).toBe(kamau[0].id);

    expect(fake.tables.audit_logs.find((e) => e.action === 'deal.import').details).toMatchObject({ imported: 4, newContacts: 1 });
  });

  test("reps import their own deals only and can't set an owner", async () => {
    const res = await upload(rep, 'title,value,stage,owner\nA,100,lead,mo@example.com\nB,200,lead,\n');
    expect(res.status).toBe(201);
    expect(res.body.skipped).toEqual([{ row: 2, reason: 'Only managers and admins can set the owner' }]);
    expect(fake.tables.deals.map((d) => d.owner_id)).toEqual([rep.id]);
  });

  test('explains missing required columns', async () => {
    const res = await upload(manager, 'name,price\nA,100\n');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required column\(s\): title, stage/);
  });
});

describe('closed_at on stage changes', () => {
  test('moving a deal to won records when it closed; editing it later does not move that date', async () => {
    fake.tables.deals = [{ id: 'd1', title: 'Order', value: 100, stage: 'negotiation', owner_id: rep.id }];

    const won = await request(app).patch('/api/deals/d1').set('Authorization', tokenFor(rep)).send({ stage: 'won' });
    const closedAt = won.body.deal.closed_at;
    expect(closedAt).toEqual(expect.any(String));

    const renamed = await request(app).patch('/api/deals/d1').set('Authorization', tokenFor(rep)).send({ title: 'Order #2' });
    expect(renamed.body.deal.closed_at).toBe(closedAt);

    const reopened = await request(app).patch('/api/deals/d1').set('Authorization', tokenFor(rep)).send({ stage: 'proposal' });
    expect(reopened.body.deal.closed_at).toBeNull();
  });
});

describe('more than 1,000 deals', () => {
  test('analytics, priority and the deals list count every deal, not just the first 1,000', async () => {
    fake.tables.deals = Array.from({ length: 1500 }, (_, i) => ({
      id: `d${String(i).padStart(4, '0')}`,
      title: `Deal ${i}`,
      value: 100,
      stage: i < 1200 ? 'won' : 'lead',
      owner_id: rep.id,
      created_at: '2026-01-01T09:00:00.000Z',
      closed_at: i < 1200 ? '2026-02-01T09:00:00.000Z' : null,
    }));

    const analytics = await request(app).get('/api/analytics/pipeline').set('Authorization', tokenFor(manager));
    expect(analytics.body.descriptive).toMatchObject({ totalDeals: 1500, wonCount: 1200, wonValue: 120000 });

    const priority = await request(app).get('/api/deals/priority').set('Authorization', tokenFor(rep));
    expect(priority.body.total).toBe(300);

    const list = await request(app).get('/api/deals').set('Authorization', tokenFor(rep));
    expect(list.body.deals).toHaveLength(1500);
    expect(new Set(list.body.deals.map((d) => d.id)).size).toBe(1500);
  });
});
