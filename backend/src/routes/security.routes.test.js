import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_SIGNUP_CODE = 'test-admin-code';

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
  test('creates a representative by default', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'longenough' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('representative');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('refuses admin without the right access code', async () => {
    for (const adminCode of [undefined, 'wrong-code']) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Eve', email: 'eve@example.com', password: 'longenough', role: 'admin', adminCode });
      expect(res.status).toBe(403);
    }
    expect(fake.tables.users).toHaveLength(4);
  });

  test('creates an admin with the right access code', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'longenough', role: 'admin', adminCode: 'test-admin-code' });

    expect(res.status).toBe(201);
    expect(fake.tables.users.find((u) => u.email === 'eve@example.com').role).toBe('admin');
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
    // The register tests above already used 5 of this file's 10 attempts
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
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

describe('admin dashboard API', () => {
  test('only admins can read the overview, config and audit log', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/config', '/api/admin/audit']) {
      for (const user of [manager, rep]) {
        const res = await request(app).get(path).set('Authorization', tokenFor(user));
        expect(res.status).toBe(403);
      }
      const res = await request(app).get(path).set('Authorization', tokenFor(admin));
      expect(res.status).toBe(200);
    }
  });

  test('overview counts users by role', async () => {
    const res = await request(app).get('/api/admin/overview').set('Authorization', tokenFor(admin));
    expect(res.body.users.byRole).toEqual({ admin: 1, manager: 1, representative: 2 });
    expect(res.body.records.contacts).toBe(2);
  });

  test('role changes are written to the audit log and can be filtered by category', async () => {
    await request(app).patch(`/api/users/${rep.id}/role`).set('Authorization', tokenFor(admin)).send({ role: 'manager' });
    await request(app).post('/api/auth/logout').set('Authorization', tokenFor(admin));

    const res = await request(app).get('/api/admin/audit?category=user').set('Authorization', tokenFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({
      user_id: admin.id,
      action: 'user.role_change',
      entity_id: rep.id,
      details: { from: 'representative', to: 'manager' },
    });

    const bad = await request(app).get('/api/admin/audit?category=nope').set('Authorization', tokenFor(admin));
    expect(bad.status).toBe(400);
  });
});

describe('system configuration', () => {
  test('managers can read conversion targets but only admins can change them', async () => {
    const read = await request(app).get('/api/settings/benchmarks').set('Authorization', tokenFor(manager));
    expect(read.status).toBe(200);

    const body = { rates: { 'lead->qualified': 0.5 } };
    const denied = await request(app).put('/api/settings/benchmarks').set('Authorization', tokenFor(manager)).send(body);
    expect(denied.status).toBe(403);
    const allowed = await request(app).put('/api/settings/benchmarks').set('Authorization', tokenFor(admin)).send(body);
    expect(allowed.status).toBe(200);
  });
});

describe('rep campaign results', () => {
  test("shows only the caller's own deals per campaign, without budget", async () => {
    fake.tables.campaigns = [{ id: 'camp-1', name: 'Radio', channel: 'radio', budget: 1000, created_at: '2026-01-01' }];
    fake.tables.deals = [
      { id: 'd1', campaign_id: 'camp-1', owner_id: rep.id, stage: 'won', value: 500 },
      { id: 'd2', campaign_id: 'camp-1', owner_id: rep.id, stage: 'lead', value: 200 },
      { id: 'd3', campaign_id: 'camp-1', owner_id: otherRep.id, stage: 'won', value: 900 },
    ];

    const res = await request(app).get('/api/analytics/campaigns/me').set('Authorization', tokenFor(rep));
    expect(res.status).toBe(200);
    expect(res.body.campaigns[0]).toMatchObject({ dealCount: 2, wonCount: 1, wonValue: 500, openValue: 200, channel: 'radio' });
    expect(res.body.campaigns[0].budget).toBeUndefined();
  });
});
