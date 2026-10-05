import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

process.env.JWT_SECRET = 'test-secret';
process.env.AI_PROVIDER = 'claude'; // Claude is mocked below; services/ai.test.js covers Ollama

const manager = { id: 'mgr-1', name: 'Mo Otieno', email: 'mo@example.com', role: 'manager' };
const rep = { id: 'rep-1', name: 'Rae Wanjiku', email: 'rae@example.com', role: 'representative', manager_id: 'mgr-1' };

let fake;
const mirrorUpsert = jest.fn();
const mirrorDelete = jest.fn();

jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert, mirrorDelete }));

// Stand-in for Claude reading a screenshot: tests set what it "sees" (or the error it throws)
const claude = { reply: null, error: null, requests: [] };
class FakeAnthropic {
  static AuthenticationError = class extends Error {};
  static RateLimitError = class extends Error {};
  static InternalServerError = class extends Error {};
  static APIConnectionError = class extends Error {};
  static BadRequestError = class extends Error {};
  beta = {
    messages: {
      stream: (params) => {
        claude.requests.push(params);
        return {
          finalMessage: async () => {
            if (claude.error) throw claude.error;
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(claude.reply) }] };
          },
        };
      },
    },
  };
}
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({ default: FakeAnthropic }));
const XLSX = await import('xlsx');

const { default: app } = await import('../app.js');

const tokenFor = (user) => `Bearer ${jwt.sign({ id: user.id, email: user.email, role: user.role }, 'test-secret')}`;
const upload = (user, csv, query = {}, filename = 'deals.csv', fields = {}) => {
  const req = request(app).post('/api/deals/import').query(query).set('Authorization', tokenFor(user));
  Object.entries(fields).forEach(([k, v]) => req.field(k, typeof v === 'string' ? v : JSON.stringify(v)));
  return req.attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf-8'), filename);
};

beforeEach(() => {
  Object.assign(claude, { reply: null, error: null, requests: [] });
  fake = createFakeSupabase(
  {
    users: [manager, rep].map((u) => ({ ...u, password_hash: 'x', is_active: true })),
    campaigns: [{ id: 'camp-radio', name: 'Radio Citizen Q1', budget: 50000 }],
    contacts: [{ id: 'c-1', name: 'Jane Achieng', company: 'Achieng Hardware', owner_id: rep.id }],
    deals: [],
  },
  { companyId: 'co-1' }
  );
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
    expect(res.body).toMatchObject({ dryRun: true, rows: 6, imported: 5, newContacts: 1, totalValue: 695000, mappedBy: 'headings' });
    expect(res.body.byStage).toEqual({ won: 2, proposal: 1, lost: 1, lead: 1 });
    // Only a row we truly can't read is skipped; an unknown campaign just isn't linked
    expect(res.body.skipped).toEqual([{ row: 6, reason: 'Can\'t read the amount "abc"' }]);
    const warnings = res.body.warnings.join(' ');
    expect(warnings).toMatch(/1 won\/lost deal has no closed date/);
    expect(warnings).toMatch(/Campaign "Facebook Ads" doesn't exist yet/);
    expect(warnings).toMatch(/1 column is not used: "Notes"/);
    expect(res.body.columns).toContainEqual({ header: 'Amount (KES)', field: 'value' });
    expect(claude.requests).toHaveLength(0); // every column was a known heading
    expect(fake.tables.deals).toHaveLength(0);
    expect(fake.tables.contacts).toHaveLength(1);
  });

  test('keeps the real dates, links campaigns, owners and contacts', async () => {
    const res = await upload(manager, SME_EXPORT);
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(5);

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

    expect(byTitle.Doors.campaign_id).toBeNull();
    expect(fake.tables.audit_logs.find((e) => e.action === 'deal.import').details).toMatchObject({ imported: 5, newContacts: 1 });
  });

  test("reps import their own deals only; a salesperson column doesn't stop the import", async () => {
    const res = await upload(rep, 'title,value,stage,owner\nA,100,lead,mo@example.com\nB,200,lead,\n');
    expect(res.status).toBe(201);
    expect(res.body.skipped).toEqual([]);
    expect(res.body.warnings.join(' ')).toMatch(/salesperson column is ignored/);
    expect(fake.tables.deals.map((d) => d.owner_id)).toEqual([rep.id, rep.id]);
  });

  test('a sales book with just a customer, an amount and a date imports as won sales', async () => {
    const res = await upload(manager, 'Customer,Price,Date\nAchieng Hardware,100,05/03/2026\n');
    expect(res.status).toBe(201);
    expect(fake.tables.deals[0]).toMatchObject({
      title: 'Sale – Achieng Hardware',
      value: 100,
      stage: 'won',
      created_at: '2026-03-05T09:00:00.000Z',
      closed_at: '2026-03-05T09:00:00.000Z',
    });
    expect(res.body.warnings.join(' ')).toMatch(/no status, so it will be imported as "won"/);
  });

  test('the user can say rows without a status are open leads instead', async () => {
    const res = await upload(manager, 'Customer,Price\nAchieng Hardware,100\n', {}, 'deals.csv', { defaultStage: 'lead' });
    expect(res.status).toBe(201);
    expect(fake.tables.deals[0]).toMatchObject({ stage: 'lead', closed_at: null });
  });

  test('unfamiliar headings and status words are matched by Claude', async () => {
    claude.reply = {
      columns: [
        { index: 0, field: 'title' },
        { index: 1, field: 'contact_name' },
        { index: 2, field: 'value' },
        { index: 3, field: 'stage' },
        { index: 4, field: 'created_date' },
        { index: 5, field: 'ignore' },
      ],
      stages: [
        { value: 'Imelipwa', stage: 'won' },
        { value: 'Bado', stage: 'negotiation' },
      ],
    };
    const csv = 'Bidhaa,Mteja,Kiasi,Hali,Tarehe,Maelezo\nSofa set,Wanjiru,"45,000",Imelipwa,02/03/2026,\nDining table,Otieno,30000,Bado,10/03/2026,deposit\n';
    const res = await upload(manager, csv, { dryRun: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mappedBy: 'ai', imported: 2, totalValue: 75000, byStage: { won: 1, negotiation: 1 } });
    expect(res.body.columns).toEqual([
      { header: 'Bidhaa', field: 'title' },
      { header: 'Mteja', field: 'contact_name' },
      { header: 'Kiasi', field: 'value' },
      { header: 'Hali', field: 'stage' },
      { header: 'Tarehe', field: 'created_date' },
      { header: 'Maelezo', field: null },
    ]);
    // Claude saw the headings, examples and the full list of status words
    const prompt = claude.requests[0].messages[0].content[0].text;
    expect(prompt).toContain('heading "Kiasi"');
    expect(prompt).toContain('"Imelipwa","Bado"');

    // Importing with the mapping from the preview saves exactly that, without asking Claude again
    const saved = await upload(manager, csv, {}, 'deals.csv', { mapping: res.body.mapping });
    expect(saved.status).toBe(201);
    expect(claude.requests).toHaveLength(1);
    expect(fake.tables.deals.map((d) => [d.title, d.stage, d.value])).toEqual([
      ['Sofa set', 'won', 45000],
      ['Dining table', 'negotiation', 30000],
    ]);
  });

  test('the user can change what a column means', async () => {
    const csv = 'Item,Customer,Amount\nSofa,Wanjiru,100\n';
    const mapping = { columns: ['contact_name', 'title', 'value'], stages: {} };
    const res = await upload(manager, csv, {}, 'deals.csv', { mapping });
    expect(res.status).toBe(201);
    expect(fake.tables.deals[0].title).toBe('Wanjiru');
  });

  test('a file with no heading row still imports, with columns matched by Claude', async () => {
    claude.reply = { columns: [{ index: 0, field: 'title' }, { index: 1, field: 'value' }], stages: [] };
    const res = await upload(manager, 'Sofa,45000\nTable,30000\n', { dryRun: 1 });
    expect(res.body).toMatchObject({ rows: 2, imported: 2, totalValue: 75000 });
    expect(res.body.columns.map((c) => c.header)).toEqual(['Column 1', 'Column 2']);
  });

  test('Swahili headings and status words are known without any AI', async () => {
    const csv = 'Tarehe,Bidhaa,Mteja,Kiasi,Hali\n02/03/2026,Sofa,Grace,45000,Imelipwa\n05/03/2026,Meza,Otieno,30000,Imeghairiwa\n';
    const res = await upload(manager, csv, { dryRun: 1 });
    expect(res.body).toMatchObject({ mappedBy: 'headings', imported: 2, byStage: { won: 1, lost: 1 } });
    expect(claude.requests).toHaveLength(0);
  });

  test("the user's reading of a status word wins, even over the built-in list", async () => {
    const csv = 'Item,Amount,Status\nSofa,100,Paid\nTable,200,Paid\n';
    const res = await upload(manager, csv, { dryRun: 1 }, 'deals.csv', {
      mapping: { columns: ['title', 'value', 'stage'], stages: { paid: 'negotiation' } },
    });
    expect(res.body.byStage).toEqual({ negotiation: 2 });
    expect(res.body.statuses).toEqual([{ value: 'Paid', count: 2, stage: 'negotiation', matched: true }]);
  });

  test('without Claude, a title row is skipped and the date and amount columns are found from their contents', async () => {
    claude.error = new FakeAnthropic.BadRequestError('Your credit balance is too low to access the Anthropic API.');
    const csv = 'MAUZO YA MWEZI\nSiku,Kitu,Mtu,Namba,Pesa\n02/03/2026,Sofa,Grace,0712 345 678,"Ksh 45,000/="\n05 Mar 2026,Table,Otieno,+254722000111,30000\n';
    const res = await upload(manager, csv, { dryRun: 1 });
    expect(res.body.columns).toEqual([
      { header: 'Siku', field: 'created_date' },
      { header: 'Kitu', field: null },
      { header: 'Mtu', field: null },
      { header: 'Namba', field: 'contact_phone' },
      { header: 'Pesa', field: 'value' },
    ]);
    expect(res.body).toMatchObject({ imported: 2, totalValue: 75000 });
    expect(res.body.notes.join(' ')).toMatch(/run out of credit/);
  });

  test('if Claude is unavailable, known headings still work and the user is told to check the columns', async () => {
    claude.error = new FakeAnthropic.AuthenticationError('invalid x-api-key');
    const res = await upload(manager, 'Kitu,Amount\nSofa,100\n', { dryRun: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mappedBy: 'headings', imported: 1 });
    expect(res.body.notes.join(' ')).toMatch(/Automatic column matching is unavailable/);
  });
});

describe('importing other file formats', () => {
  const extractedRow = (over) => ({
    title: '', value: '', stage: '', created_date: '', closed_date: '', expected_close_date: '',
    campaign: '', contact_name: '', company: '', contact_email: '', contact_phone: '', owner: '', ...over,
  });

  test('Excel: finds the header under a report title and reads date cells without day/month mix-ups', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Achieng Hardware - Sales March 2026'],
      [],
      ['Deal Name', 'Amount', 'Status', 'Date Created', 'Date Won'],
      ['Shop shelving', 120000, 'Won', new Date(Date.UTC(2026, 2, 2)), new Date(Date.UTC(2026, 2, 20))],
      ['Roofing', 90000, 'Quote sent', new Date(Date.UTC(2026, 3, 1)), ''],
    ], { cellDates: true, dateNF: 'm/d/yy' });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'March');
    const xlsx = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });

    const res = await upload(manager, xlsx, {}, 'sales.xlsx');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: 2, readBy: 'file', totalValue: 210000 });
    const byTitle = Object.fromEntries(fake.tables.deals.map((d) => [d.title, d]));
    expect(byTitle['Shop shelving']).toMatchObject({ created_at: '2026-03-02T09:00:00.000Z', closed_at: '2026-03-20T09:00:00.000Z' });
    expect(byTitle.Roofing).toMatchObject({ stage: 'proposal', created_at: '2026-04-01T09:00:00.000Z' });
  });

  test('semicolon-separated text with commas inside amounts', async () => {
    const res = await upload(rep, 'Deal;Amount;Status\nTiles;KES 30,000;won\nPaint;1,500;lead\n', {}, 'export.txt');
    expect(res.status).toBe(201);
    expect(fake.tables.deals.map((d) => d.value)).toEqual([30000, 1500]);
  });

  test('JSON list of deals', async () => {
    const json = JSON.stringify({ deals: [{ title: 'Doors', amount: 5000, status: 'lead' }] });
    const res = await upload(rep, json, {}, 'deals.json');
    expect(res.status).toBe(201);
    expect(fake.tables.deals[0]).toMatchObject({ title: 'Doors', value: 5000, stage: 'lead' });
  });

  test('a screenshot is read by Claude and the rows come back for checking; nothing is saved', async () => {
    claude.reply = {
      rows: [
        extractedRow({ title: 'Shop shelving', value: 'KES 120,000', stage: 'won', created_date: '2026-03-02', closed_date: '2026-03-20', owner: 'Mo Otieno' }),
        extractedRow({ title: 'Cement', value: '45,000', stage: 'proposal' }),
      ],
      notes: ['The phone number for Cement is cut off'],
    };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    const res = await upload(rep, png, { dryRun: 1 }, 'whatsapp-image.png');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ readBy: 'ai', imported: 2, totalValue: 165000, notes: ['The phone number for Cement is cut off'] });
    // Reps can't set owners, so the salesperson column isn't read for them
    expect(res.body.extracted.headers).not.toContain('owner');
    expect(res.body.extracted.rows[0].slice(0, 3)).toEqual(['Shop shelving', 'KES 120,000', 'won']);
    expect(res.body.skipped).toEqual([]);
    expect(claude.requests[0].messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(fake.tables.deals).toHaveLength(0);
  });

  test('explains when screenshot reading is not set up', async () => {
    claude.error = new FakeAnthropic.AuthenticationError('invalid x-api-key');
    const res = await upload(rep, Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { dryRun: 1 }, 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not set up on this server/);
  });

  test('turns away Word files with a hint', async () => {
    const res = await upload(rep, Buffer.from('PKword'), {}, 'deals.docx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Save it as a PDF, or take a screenshot/);
  });
});

describe('closed_at on stage changes', () => {
  test('moving a deal to won records when it closed; editing it later does not move that date', async () => {
    fake.tables.deals = [{ id: 'd1', company_id: 'co-1', title: 'Order', value: 100, stage: 'negotiation', owner_id: rep.id }];

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
      company_id: 'co-1',
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
