import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabaseClient.js';
import rateLimit from 'express-rate-limit';
import { mirrorUpsert } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { createResetToken, findUsableReset, RESET_TOKEN_MINUTES } from '../services/passwordReset.js';

const router = express.Router();

export const MIN_PASSWORD_LENGTH = 8;

// POST /api/auth/logout — tokens are stateless, so the client discards its copy;
// this records the sign-out in the audit log. Declared before the rate limiter so
// signing out never uses up login attempts.
router.post('/logout', requireAuth, async (req, res) => {
  await recordAudit(req.user, 'auth.logout', { entity: 'user', entityId: req.user.id });
  return res.json({ success: true });
});

// Slows password guessing: 10 attempts per IP per 15 minutes across login and register
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts — please wait 15 minutes and try again' },
  })
);

const SIGNUP_ROLES = ['representative', 'manager', 'admin'];

// Compares hashes so the check takes the same time whatever the code's length
function matchesAdminCode(code) {
  const expected = process.env.ADMIN_SIGNUP_CODE;
  if (!expected || typeof code !== 'string') return false;
  const hash = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(code), hash(expected));
}

// POST /api/auth/register — anyone can sign up as a representative.
// Manager and admin sign-ups need the ADMIN_SIGNUP_CODE from backend/.env,
// so nobody can grant themselves elevated access without it. Admins can also
// promote existing users via PATCH /api/users/:id/role.
router.post('/register', async (req, res) => {
  const { name, email, password, role = 'representative', adminCode } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (!SIGNUP_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${SIGNUP_ROLES.join(', ')}` });
  }
  if (role !== 'representative' && !matchesAdminCode(adminCode)) {
    return res.status(403).json({ error: 'Invalid admin access code' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert([{ name, email, password_hash, role }])
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  await mirrorUpsert('users', data);
  await recordAudit(data, 'auth.register', { entity: 'user', entityId: data.id, details: { role } });
  const { id, name: savedName, email: savedEmail, role: savedRole } = data;
  return res.status(201).json({ user: { id, name: savedName, email: savedEmail, role: savedRole } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, password_hash, role, is_active')
    .eq('email', email)
    .single();

  if (error || !user) {
    await recordAudit(null, 'auth.login_failed', { details: { email } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await recordAudit(user, 'auth.login_failed', { entity: 'user', entityId: user.id, details: { email } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Checked after the password so the message doesn't reveal which emails exist
  if (user.is_active === false) {
    await recordAudit(user, 'auth.login_blocked', { entity: 'user', entityId: user.id });
    return res.status(403).json({ error: 'Your account has been disabled. Contact your administrator.' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  await recordAudit(user, 'auth.login', { entity: 'user', entityId: user.id });

  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// POST /api/auth/forgot-password — body { email }. Always answers the same way so the
// form can't be used to find out which emails have accounts.
// SalesMesh has no email service yet, so outside production the reset link comes back in
// the response and the page goes straight to it; in production an admin issues the link
// from the account page instead.
router.post('/forgot-password', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!email) return res.status(400).json({ error: 'email is required' });

  const message = `If that email has an active account, a reset link has been created. It works for ${RESET_TOKEN_MINUTES} minutes.`;
  // Escape ILIKE wildcards so "%" in the input can't match other people's emails
  const pattern = email.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data: user, error } = await supabase.from('users').select('id, name, email, is_active').ilike('email', pattern).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!user || user.is_active === false) {
    await recordAudit(null, 'auth.password_reset_requested', { details: { email, matched: false } });
    return res.json({ message });
  }

  try {
    const { resetPath } = await createResetToken(user.id);
    await recordAudit(user, 'auth.password_reset_requested', { entity: 'user', entityId: user.id, details: { email: user.email } });
    const showLink = process.env.NODE_ENV !== 'production';
    return res.json({ message, ...(showLink && { resetPath }) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/reset-password — body { token, password }
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  let reset;
  try {
    reset = await findUsableReset(token);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!reset) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase
    .from('users')
    .update({ password_hash })
    .eq('id', reset.user_id)
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!user) return res.status(400).json({ error: 'This account no longer exists' });
  await mirrorUpsert('users', user);

  const { data: used } = await supabase
    .from('password_resets')
    .update({ used_at: new Date().toISOString() })
    .eq('id', reset.id)
    .select();
  await mirrorUpsert('password_resets', used);

  await recordAudit(user, 'auth.password_reset', {
    entity: 'user',
    entityId: user.id,
    details: { viaAdminLink: Boolean(reset.created_by) },
  });
  return res.json({ success: true, email: user.email });
});

export default router;
