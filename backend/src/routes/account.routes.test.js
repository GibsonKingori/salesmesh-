import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

// Account administration and password resets. Kept apart from security.routes.test.js
// because the auth rate limiter (10 attempts per file) is shared within a test file:
// this file makes 8 rate-limited auth calls.
process.env.JWT_SECRET = 'test-secret';

const PASSWORD = 'original-pass';
const admin = { id: 'admin-1', name: 'Ada', email: 'ada@example.com', role: 'admin' };
const manager = { id: 'mgr-1', name: 'Mo', email: 'mo@example.com', role: 'manager' };
const rep = { id: 'rep-1', name: 'Rae', email: 'rae@example.com', role: 'representative' };
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

let fake;
const mirrorUpsert = jest.fn();
const mirrorDelete = jest.fn();

jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert, mirrorDelete }));

const { default: app } = await import('../app.js');

const tokenFor = (user) => `Bearer ${jwt.sign({ id: user.id, email: user.email, role: user.role }, 'test-secret')}`;
const asAdmin = (req) => req.set('Authorization', tokenFor(admin));
const auditActions = () => fake.tables.audit_logs?.map((e) => e.action) ?? [];

beforeEach(() => {
  fake = createFakeSupabase({
    users: [admin, manager, rep].map((u) => ({ ...u, password_hash: passwordHash, is_active: true })),
    campaigns: [{ id: 'camp-1', name: 'Radio push', budget: 5000, created_by: manager.id, created_at: '2026-09-01' }],
    deals: [
      { id: 'deal-1', title: 'Shop fit-out', value: 1000, stage: 'lead', owner_id: rep.id, campaign_id: 'camp-1', created_at: '2026-09-02' },
    ],
  });
  mirrorUpsert.mockClear();
  mirrorDelete.mockClear();
});

describe('enabling and disabling accounts', () => {
  test('a disabled account cannot log in, and its open session stops working', async () => {
    const res = await asAdmin(request(app).patch(`/api/users/${rep.id}/status`)).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.user.is_active).toBe(false);

    const login = await request(app).post('/api/auth/login').send({ email: rep.email, password: PASSWORD });
    expect(login.status).toBe(403);

    const session = await request(app).get('/api/deals').set('Authorization', tokenFor(rep));
    expect(session.status).toBe(401);
    expect(session.body.code).toBe('account_disabled');

    expect(auditActions()).toEqual(expect.arrayContaining(['user.disable', 'auth.login_blocked']));
  });

  test('only admins can change status, and not their own', async () => {
    const byManager = await request(app).patch(`/api/users/${rep.id}/status`).set('Authorization', tokenFor(manager)).send({ active: false });
    expect(byManager.status).toBe(403);
    const self = await asAdmin(request(app).patch(`/api/users/${admin.id}/status`)).send({ active: false });
    expect(self.status).toBe(400);
    const bad = await asAdmin(request(app).patch(`/api/users/${rep.id}/status`)).send({ active: 'no' });
    expect(bad.status).toBe(400);
  });

  test('a role change applies to the next request, not the next login', async () => {
    await asAdmin(request(app).patch(`/api/users/${manager.id}/role`)).send({ role: 'representative' });
    const res = await request(app).get('/api/analytics/pipeline').set('Authorization', tokenFor(manager));
    expect(res.status).toBe(403);
  });
});

describe('password reset', () => {
  test('unknown emails get the same answer and no link', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.resetPath).toBeUndefined();
  });

  test('a user can reset their password once with the link, and it is audited', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'RAE@example.com' });
    expect(forgot.body.resetPath).toMatch(/^\/reset-password\?token=/);
    const token = new URLSearchParams(forgot.body.resetPath.split('?')[1]).get('token');
    expect(fake.tables.password_resets[0].token_hash).not.toBe(token);

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'brand-new-pass' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send({ email: rep.email, password: 'brand-new-pass' });
    expect(login.status).toBe(200);

    const reused = await request(app).post('/api/auth/reset-password').send({ token, password: 'another-pass' });
    expect(reused.status).toBe(400);

    expect(auditActions()).toEqual(expect.arrayContaining(['auth.password_reset_requested', 'auth.password_reset']));
  });

  test('an expired link is refused', async () => {
    const { hashToken } = await import('../services/passwordReset.js');
    fake.tables.password_resets = [
      {
        id: 'pr-1',
        user_id: rep.id,
        token_hash: hashToken('expired-token-0123456789'),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        used_at: null,
      },
    ];
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'expired-token-0123456789', password: 'brand-new-pass' });
    expect(res.status).toBe(400);
  });

  test('an admin can issue a reset link for a user', async () => {
    const link = await asAdmin(request(app).post(`/api/admin/users/${rep.id}/reset-link`));
    expect(link.status).toBe(201);
    const token = new URLSearchParams(link.body.resetPath.split('?')[1]).get('token');

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'from-admin-link' });
    expect(reset.status).toBe(200);
    expect(auditActions()).toEqual(expect.arrayContaining(['user.reset_link', 'auth.password_reset']));
  });
});

describe("admin access to someone's account", () => {
  test("shows the account's deals and campaigns", async () => {
    const res = await asAdmin(request(app).get(`/api/admin/users/${rep.id}`));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(rep.email);
    expect(res.body.deals.map((d) => d.id)).toEqual(['deal-1']);
    expect(res.body.campaigns).toEqual([expect.objectContaining({ id: 'camp-1', relation: 'linked', dealCount: 1 })]);
  });

  test('admin can add and delete deals for a user', async () => {
    const created = await asAdmin(request(app).post(`/api/admin/users/${rep.id}/deals`)).send({ title: 'New order', value: 2500, stage: 'proposal' });
    expect(created.status).toBe(201);
    expect(created.body.deal.owner_id).toBe(rep.id);

    const bad = await asAdmin(request(app).post(`/api/admin/users/${rep.id}/deals`)).send({ title: 'x', value: 1, stage: 'maybe' });
    expect(bad.status).toBe(400);

    const deleted = await asAdmin(request(app).delete(`/api/admin/deals/${created.body.deal.id}`));
    expect(deleted.status).toBe(204);
    expect(fake.tables.deals.map((d) => d.id)).toEqual(['deal-1']);

    const entry = fake.tables.audit_logs.find((e) => e.action === 'deal.create');
    expect(entry).toMatchObject({ user_id: admin.id, details: { forUserId: rep.id } });
  });

  test('admin can add a campaign for a user, and deleting one keeps its deals', async () => {
    const created = await asAdmin(request(app).post(`/api/admin/users/${manager.id}/campaigns`)).send({ name: 'SMS blast', budget: 800, channel: 'SMS' });
    expect(created.status).toBe(201);
    expect(created.body.campaign.created_by).toBe(manager.id);

    const deleted = await asAdmin(request(app).delete('/api/admin/campaigns/camp-1'));
    expect(deleted.status).toBe(204);
    expect(fake.tables.campaigns.map((c) => c.name)).toEqual(['SMS blast']);
    expect(fake.tables.deals[0]).toMatchObject({ id: 'deal-1', campaign_id: null });
  });

  test('managers cannot use the admin account tools', async () => {
    const res = await request(app).get(`/api/admin/users/${rep.id}`).set('Authorization', tokenFor(manager));
    expect(res.status).toBe(403);
  });
});

describe('audit log filters', () => {
  test('filters by day and by name', async () => {
    fake.tables.audit_logs = [
      { id: 'a1', action: 'auth.login', user_name: 'Rae', created_at: '2026-10-01T09:00:00.000Z' },
      { id: 'a2', action: 'auth.login', user_name: 'Mo', created_at: '2026-10-02T09:00:00.000Z' },
      { id: 'a3', action: 'deal.create', user_name: 'Rae', created_at: '2026-10-02T15:00:00.000Z' },
    ];
    const day = await asAdmin(request(app).get('/api/admin/audit')).query({
      from: '2026-10-02T00:00:00.000Z',
      to: '2026-10-03T00:00:00.000Z',
    });
    expect(day.body.entries.map((e) => e.id)).toEqual(['a3', 'a2']);

    const byName = await asAdmin(request(app).get('/api/admin/audit')).query({ q: 'rae' });
    expect(byName.body.entries.map((e) => e.id)).toEqual(['a3', 'a1']);

    const bad = await asAdmin(request(app).get('/api/admin/audit')).query({ from: 'yesterday' });
    expect(bad.status).toBe(400);
  });
});
