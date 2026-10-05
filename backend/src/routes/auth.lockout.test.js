import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

// Login lockout is per account: one user's wrong guesses must never block anyone else,
// even when everyone signs in from the same IP (as every request here does)
process.env.JWT_SECRET = 'test-secret';

const PASSWORD = 'correct-pass';
const admin = { id: 'admin-1', name: 'Ada', email: 'ada@example.com', role: 'admin' };
const rep = { id: 'rep-1', name: 'Rae', email: 'rae@example.com', role: 'representative' };
const otherRep = { id: 'rep-2', name: 'Ron', email: 'ron@example.com', role: 'representative' };
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

let fake;
jest.unstable_mockModule('../config/supabaseClient.js', () => ({
  supabase: { from: (table) => fake.from(table) },
}));
jest.unstable_mockModule('../config/postgresClient.js', () => ({ pool: null, mirrorUpsert: jest.fn(), mirrorDelete: jest.fn() }));

const { default: app } = await import('../app.js');
const { MAX_FAILED_LOGINS } = await import('./auth.routes.js');

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const failTimes = async (email, times) => {
  for (let i = 0; i < times; i++) expect((await login(email, 'wrong-pass')).status).toBe(401);
};

beforeEach(() => {
  fake = createFakeSupabase({
    users: [admin, rep, otherRep].map((u) => ({ ...u, password_hash: passwordHash, is_active: true })),
  });
});

test('locks only the account with too many failed attempts', async () => {
  await failTimes(rep.email, MAX_FAILED_LOGINS);

  const locked = await login(rep.email, PASSWORD);
  expect(locked.status).toBe(429);
  expect(locked.body.error).toMatch(/this account/);
  // Same email in different case is the same account
  expect((await login('RAE@example.com', PASSWORD)).status).toBe(429);

  expect((await login(admin.email, PASSWORD)).status).toBe(200);
  expect((await login(otherRep.email, PASSWORD)).status).toBe(200);
  expect(fake.tables.audit_logs.map((e) => e.action)).toContain('auth.login_locked');
});

test('successful logins never count, and a correct password clears earlier failures', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS + 2; i++) expect((await login(admin.email, PASSWORD)).status).toBe(200);

  await failTimes(otherRep.email, MAX_FAILED_LOGINS - 1);
  expect((await login(otherRep.email, PASSWORD)).status).toBe(200);
  await failTimes(otherRep.email, MAX_FAILED_LOGINS - 1);
  expect((await login(otherRep.email, PASSWORD)).status).toBe(200);
});
