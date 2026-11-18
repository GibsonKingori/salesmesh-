import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

process.env.JWT_SECRET = 'test-secret';

const manager = { id: 'manager-1', name: 'Mo', email: 'mo@example.com', role: 'manager' };
const rep = { id: 'rep-1', name: 'Rae', email: 'rae@example.com', role: 'representative', manager_id: manager.id };
let fake;
const mirrorUpsert = jest.fn();
const mirrorDelete = jest.fn();

jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert, mirrorDelete }));

const { default: app } = await import('../app.js');
const tokenFor = (user) => `Bearer ${jwt.sign({ id: user.id, email: user.email, role: user.role }, 'test-secret')}`;

beforeEach(() => {
  fake = createFakeSupabase(
    {
      users: [manager, rep].map((user) => ({ ...user, password_hash: 'x' })),
      deals: [{ id: 'deal-1', title: 'Existing deal', value: 100, stage: 'lead', owner_id: rep.id }],
    },
    { companyId: 'company-1' }
  );
  mirrorUpsert.mockClear();
  mirrorDelete.mockClear();
});

async function createTwice(path, user, body, id) {
  const create = () =>
    request(app)
      .post(path)
      .set('Authorization', tokenFor(user))
      .set('Idempotency-Key', id)
      .send(body);
  return [await create(), await create()];
}

test('contact create uses the offline ID and retry does not duplicate it', async () => {
  const id = '94c604f3-d5b5-48a5-baaa-67f3b2c7af04';
  const [first, retry] = await createTwice('/api/contacts', rep, { name: 'Offline contact' }, id);

  expect(first.status).toBe(201);
  expect(first.body.contact.id).toBe(id);
  expect(retry.status).toBe(200);
  expect(fake.tables.contacts.filter((contact) => contact.id === id)).toHaveLength(1);
});

test('activity create uses the offline ID and retry does not duplicate it', async () => {
  const id = 'e2b55a84-76c3-4f4e-9ef8-4fdd35bd93a2';
  const [first, retry] = await createTwice('/api/activities', rep, { deal_id: 'deal-1', type: 'note', notes: 'Offline note' }, id);

  expect(first.status).toBe(201);
  expect(first.body.activity.id).toBe(id);
  expect(retry.status).toBe(200);
  expect(fake.tables.activities.filter((activity) => activity.id === id)).toHaveLength(1);
});

test('campaign create uses the offline ID and retry does not duplicate it', async () => {
  const id = 'fe7a4f2e-8b78-43b0-a587-70dbf71e6a51';
  const [first, retry] = await createTwice('/api/campaigns', manager, { name: 'Offline campaign' }, id);

  expect(first.status).toBe(201);
  expect(first.body.campaign.id).toBe(id);
  expect(retry.status).toBe(200);
  expect(fake.tables.campaigns.filter((campaign) => campaign.id === id)).toHaveLength(1);
});
