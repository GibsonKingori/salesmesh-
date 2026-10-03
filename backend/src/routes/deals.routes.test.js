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

describe('GET /api/deals search, filters and paging', () => {
  const day = (n) => `2026-09-${String(n).padStart(2, '0')}T00:00:00Z`;

  beforeEach(() => {
    fake = createFakeSupabase({
      users: [manager, rep, otherRep].map((u) => ({ ...u, password_hash: 'x' })),
      deals: [
        { id: 'o1', title: 'Acme renewal', value: 100, stage: 'lead', owner_id: rep.id, campaign_id: 'cmp-1', created_at: day(1), updated_at: day(1) },
        { id: 'o2', title: 'Globex 100% upgrade', value: 200, stage: 'proposal', owner_id: otherRep.id, created_at: day(2), updated_at: day(2) },
        { id: 'o3', title: 'ACME expansion', value: 300, stage: 'negotiation', owner_id: otherRep.id, created_at: day(3), updated_at: day(3) },
        { id: 'w1', title: 'Initech won', value: 400, stage: 'won', owner_id: rep.id, created_at: day(4), updated_at: day(9) },
        { id: 'l1', title: 'Acme lost', value: 500, stage: 'lost', owner_id: rep.id, created_at: day(5), updated_at: day(7) },
      ],
    });
  });

  const get = (path, user = manager) => request(app).get(path).set('Authorization', tokenFor(user));
  const ids = (res) => res.body.deals.map((d) => d.id);

  test('no options returns everything, newest first, with a total', async () => {
    const res = await get('/api/deals');
    expect(ids(res)).toEqual(['l1', 'w1', 'o3', 'o2', 'o1']);
    expect(res.body.total).toBe(5);
  });

  test('search matches part of the title, ignoring case', async () => {
    expect(ids(await get('/api/deals?q=acme'))).toEqual(['l1', 'o3', 'o1']);
  });

  test('% in a search is matched literally, not as a wildcard', async () => {
    expect(ids(await get('/api/deals?q=100%25'))).toEqual(['o2']);
    expect(ids(await get('/api/deals?q=a%25e'))).toEqual([]);
  });

  test('closed deals come most recently updated first', async () => {
    expect(ids(await get('/api/deals?status=closed'))).toEqual(['w1', 'l1']);
  });

  test('pages report the total of all matches', async () => {
    const res = await get('/api/deals?status=open&limit=2&offset=0');
    expect(ids(res)).toEqual(['o3', 'o2']);
    expect(res.body.total).toBe(3);
    expect(ids(await get('/api/deals?status=open&limit=2&offset=2'))).toEqual(['o1']);
  });

  test('manager can filter by owner and campaign', async () => {
    expect(ids(await get(`/api/deals?owner_id=${otherRep.id}`))).toEqual(['o3', 'o2']);
    expect(ids(await get('/api/deals?campaign_id=cmp-1'))).toEqual(['o1']);
  });

  test("a rep can't use the owner filter to see another rep's deals", async () => {
    const res = await get(`/api/deals?owner_id=${otherRep.id}`, rep);
    expect(ids(res)).toEqual(['l1', 'w1', 'o1']);
  });

  test('bad paging is rejected', async () => {
    expect((await get('/api/deals?limit=500')).status).toBe(400);
  });

  test('priority list keeps scores the same when filtered', async () => {
    const all = await get('/api/deals/priority');
    const filtered = await get('/api/deals/priority?q=acme');
    const scoreOf = (res, id) => res.body.deals.find((d) => d.id === id).priority_score;

    expect(all.body.total).toBe(3);
    expect(ids(filtered).sort()).toEqual(['o1', 'o3']);
    expect(filtered.body.total).toBe(2);
    expect(scoreOf(filtered, 'o1')).toBe(scoreOf(all, 'o1'));
    expect(scoreOf(filtered, 'o3')).toBe(scoreOf(all, 'o3'));
  });

  test('priority list pages in ranked order', async () => {
    const all = ids(await get('/api/deals/priority'));
    const res = await get('/api/deals/priority?limit=2&offset=1');
    expect(ids(res)).toEqual(all.slice(1, 3));
    expect(res.body.total).toBe(3);
  });
});

describe('GET /api/users/team', () => {
  test('managers get names and roles only', async () => {
    const res = await request(app).get('/api/users/team').set('Authorization', tokenFor(manager));
    expect(res.status).toBe(200);
    expect(res.body.users[0]).toEqual({ id: expect.any(String), name: expect.any(String), role: expect.any(String) });
  });

  test('reps are refused', async () => {
    const res = await request(app).get('/api/users/team').set('Authorization', tokenFor(rep));
    expect(res.status).toBe(403);
  });
});
