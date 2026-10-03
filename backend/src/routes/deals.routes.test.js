import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

process.env.JWT_SECRET = 'test-secret';

const manager = { id: 'mgr-1', name: 'Mo', email: 'mo@example.com', role: 'manager' };
const rep = { id: 'rep-1', name: 'Rae', email: 'rae@example.com', role: 'representative' };
const otherRep = { id: 'rep-2', name: 'Ron', email: 'ron@example.com', role: 'representative' };

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
  fake = createFakeSupabase({
    users: [manager, rep, otherRep].map((u) => ({ ...u, password_hash: 'x' })),
    deals: [
      { id: 'd-rep', title: 'Rae deal', value: 1000, stage: 'lead', owner_id: rep.id },
      { id: 'd-other', title: 'Ron deal', value: 2000, stage: 'proposal', owner_id: otherRep.id },
    ],
  });
  mirrorUpsert.mockClear();
  mirrorDelete.mockClear();
});

describe('DELETE /api/deals/:id', () => {
  test('rep can delete their own deal, and the mirror is told', async () => {
    const res = await request(app).delete('/api/deals/d-rep').set('Authorization', tokenFor(rep));

    expect(res.status).toBe(204);
    expect(fake.tables.deals.map((d) => d.id)).toEqual(['d-other']);
    expect(mirrorDelete).toHaveBeenCalledWith('deals', [{ id: 'd-rep' }]);
  });

  test("rep cannot delete another rep's deal", async () => {
    const res = await request(app).delete('/api/deals/d-other').set('Authorization', tokenFor(rep));

    expect(res.status).toBe(404);
    expect(fake.tables.deals).toHaveLength(2);
    expect(mirrorDelete).not.toHaveBeenCalled();
  });

  test("manager can delete any rep's deal", async () => {
    const res = await request(app).delete('/api/deals/d-other').set('Authorization', tokenFor(manager));

    expect(res.status).toBe(204);
    expect(fake.tables.deals.map((d) => d.id)).toEqual(['d-rep']);
  });

  test('unknown deal is 404', async () => {
    const res = await request(app).delete('/api/deals/nope').set('Authorization', tokenFor(manager));
    expect(res.status).toBe(404);
  });

  test('requires a login', async () => {
    const res = await request(app).delete('/api/deals/d-rep');
    expect(res.status).toBe(401);
    expect(fake.tables.deals).toHaveLength(2);
  });
});
