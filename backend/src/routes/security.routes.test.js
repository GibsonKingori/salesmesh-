import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

process.env.JWT_SECRET = 'test-secret';

const admin = { id: 'admin-1', name: 'Ada', email: 'ada@example.com', role: 'admin' };
const manager = { id: 'mgr-1', name: 'Mo', email: 'mo@example.com', role: 'manager' };
const rep = { id: 'rep-1', name: 'Rae', email: 'rae@example.com', role: 'representative' };
const otherRep = { id: 'rep-2', name: 'Ron', email: 'ron@example.com', role: 'representative' };

let fake;
const mirrorUpsert = jest.fn();
const mirrorDelete = jest.fn();

// Forwards to whichever fake beforeEach created, so every test starts from the same seed data
jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert, mirrorDelete }));

const { default: app } = await import('../app.js');

const tokenFor = (user) => `Bearer ${jwt.sign({ id: user.id, email: user.email, role: user.role }, 'test-secret')}`;

beforeEach(() => {
  fake = createFakeSupabase({
    users: [admin, manager, rep, otherRep].map((u) => ({ ...u, password_hash: 'x' })),
    contacts: [
      { id: 'c-rep', name: 'Wanjiku', owner_id: rep.id },
      { id: 'c-other', name: 'Otieno', owner_id: otherRep.id },
    ],
  });
  mirrorUpsert.mockClear();
  mirrorDelete.mockClear();
});

describe('POST /api/auth/register', () => {
  test('always creates a representative, even when admin is requested', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'longenough', role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('representative');
    expect(fake.tables.users.find((u) => u.email === 'eve@example.com').role).toBe('representative');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('rejects passwords shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(fake.tables.users).toHaveLength(4);
  });
});

describe('auth rate limiting', () => {
  test('blocks an IP after 10 attempts in the window', async () => {
    // The two register tests above already used 2 of this file's 10 attempts
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
  });
});

describe('contacts ownership', () => {
  test("rep cannot edit another rep's contact", async () => {
    const res = await request(app).patch('/api/contacts/c-other').set('Authorization', tokenFor(rep)).send({ name: 'Hacked' });

    expect(res.status).toBe(404);
    expect(fake.tables.contacts.find((c) => c.id === 'c-other').name).toBe('Otieno');
  });

  test("rep cannot delete another rep's contact", async () => {
    const res = await request(app).delete('/api/contacts/c-other').set('Authorization', tokenFor(rep));

    expect(res.status).toBe(404);
    expect(fake.tables.contacts).toHaveLength(2);
    expect(mirrorDelete).not.toHaveBeenCalled();
  });

  test('rep can edit their own contact, and only the fields sent change', async () => {
    const res = await request(app).patch('/api/contacts/c-rep').set('Authorization', tokenFor(rep)).send({ phone: '0712345678' });

    expect(res.status).toBe(200);
    expect(res.body.contact).toMatchObject({ name: 'Wanjiku', phone: '0712345678' });
    expect(mirrorUpsert).toHaveBeenCalledWith('contacts', expect.objectContaining({ id: 'c-rep' }));
  });

  test("manager can delete any rep's contact", async () => {
    const res = await request(app).delete('/api/contacts/c-other').set('Authorization', tokenFor(manager));

    expect(res.status).toBe(204);
    expect(fake.tables.contacts.map((c) => c.id)).toEqual(['c-rep']);
    expect(mirrorDelete).toHaveBeenCalledWith('contacts', [{ id: 'c-other' }]);
  });

  test('empty update is rejected', async () => {
    const res = await request(app).patch('/api/contacts/c-rep').set('Authorization', tokenFor(rep)).send({});
    expect(res.status).toBe(400);
  });
});

describe('user role management', () => {
  test('admin can promote a representative to manager', async () => {
    const res = await request(app).patch(`/api/users/${rep.id}/role`).set('Authorization', tokenFor(admin)).send({ role: 'manager' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: rep.id, role: 'manager' });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(mirrorUpsert).toHaveBeenCalledWith('users', expect.objectContaining({ id: rep.id, role: 'manager' }));
  });

  test('managers and reps cannot change roles', async () => {
    for (const user of [manager, rep]) {
      const res = await request(app).patch(`/api/users/${otherRep.id}/role`).set('Authorization', tokenFor(user)).send({ role: 'admin' });
      expect(res.status).toBe(403);
    }
    expect(fake.tables.users.find((u) => u.id === otherRep.id).role).toBe('representative');
  });

  test('admin cannot change their own role', async () => {
    const res = await request(app).patch(`/api/users/${admin.id}/role`).set('Authorization', tokenFor(admin)).send({ role: 'representative' });
    expect(res.status).toBe(400);
  });

  test('unknown role and unknown user are rejected', async () => {
    const bad = await request(app).patch(`/api/users/${rep.id}/role`).set('Authorization', tokenFor(admin)).send({ role: 'owner' });
    expect(bad.status).toBe(400);
    const missing = await request(app).patch('/api/users/nope/role').set('Authorization', tokenFor(admin)).send({ role: 'manager' });
    expect(missing.status).toBe(404);
  });

  test('user list hides password hashes', async () => {
    const res = await request(app).get('/api/users').set('Authorization', tokenFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(4);
    expect(res.body.users.every((u) => u.password_hash === undefined)).toBe(true);
  });
});

test('responses carry helmet security headers', async () => {
  const res = await request(app).get('/api/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
