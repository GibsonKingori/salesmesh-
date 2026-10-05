import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabaseClient.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { mirrorUpsert } from '../config/postgresClient.js';
import { requireAuth } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { createResetToken, findUsableReset, RESET_TOKEN_MINUTES } from '../services/passwordReset.js';
import { createCompany, deleteCompany, findCompany, findCompanyByJoinCode } from '../services/companies.js';

const router = express.Router();

export const MIN_PASSWORD_LENGTH = 8;

// POST /api/auth/logout — tokens are stateless, so the client discards its copy;
// this records the sign-out in the audit log. Not rate limited, so signing out never
// uses up login attempts.
router.post('/logout', requireAuth, async (req, res) => {
  await recordAudit(req.user, 'auth.logout', { entity: 'user', entityId: req.user.id });
  return res.json({ success: true });
});

const LOCKOUT_MINUTES = 15;
export const MAX_FAILED_LOGINS = 5;

// Limits are per account (email), not per IP: everyone in one office, or on localhost,
// shares an IP, and one person's wrong guesses must not lock out their colleagues or the admin
const normalizedEmail = (req) => (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '');
const emailOrIpKey = (req) => {
  const email = normalizedEmail(req);
  return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip)}`;
};

// So a lockout shows up in that company's audit log (null if no such account)
async function companyIdForEmail(email) {
  const pattern = email.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data } = await supabase.from('users').select('company_id').ilike('email', pattern).maybeSingle();
  return data?.company_id ?? null;
}

const limiter = ({ limit, keyGenerator, error, auditAction, countSuccesses = false }) =>
  rateLimit({
    windowMs: LOCKOUT_MINUTES * 60 * 1000,
    limit,
    keyGenerator,
    // Normally only failed attempts (4xx/5xx) count, so successful use never spends anyone's allowance
    skipSuccessfulRequests: !countSuccesses,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: async (req, res, next, options) => {
      if (auditAction) {
        const email = normalizedEmail(req) || null;
        await recordAudit(null, auditAction, { details: { email }, companyId: email ? await companyIdForEmail(email) : null });
      }
      return res.status(options.statusCode).json({ error });
    },
  });

// 5 wrong passwords locks that one account for 15 minutes; a correct password clears its count
const loginLimiter = limiter({
  limit: MAX_FAILED_LOGINS,
  keyGenerator: emailOrIpKey,
  error: `Too many failed sign-in attempts for this account. Please wait ${LOCKOUT_MINUTES} minutes and try again.`,
  auditAction: 'auth.login_locked',
});

// Forgot-password always answers 200 (so it can't reveal which emails exist), so every request counts
const forgotPasswordLimiter = limiter({
  limit: 5,
  keyGenerator: emailOrIpKey,
  countSuccesses: true,
  error: `Too many reset requests for this email. Please wait ${LOCKOUT_MINUTES} minutes and try again.`,
});

// Register (join code guessing) and reset-password (token guessing) have no account to key on,
// so they stay per IP, but only failures count
const ipLimiter = limiter({
  limit: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  error: `Too many failed attempts. Please wait ${LOCKOUT_MINUTES} minutes and try again.`,
});

const companyOf = async (companyId) => {
  const company = await findCompany(companyId);
  return company ? { id: company.id, name: company.name } : null;
};

// POST /api/auth/register — body { name, email, password } plus exactly one of:
//   companyName — start a new company; you become its admin and get a join code to share
//   joinCode    — join an existing company as a representative. Its admin can then make you a
//                 manager or admin and assign you to a manager (PATCH /api/users/:id/...).
router.post('/register', ipLimiter, async (req, res) => {
  const { name, email, password, joinCode } = req.body;
  const companyName = typeof req.body.companyName === 'string' ? req.body.companyName.trim() : '';

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (Boolean(companyName) === Boolean(joinCode)) {
    return res.status(400).json({ error: 'Give either a company name (to start a company) or a join code (to join one)' });
  }

  let company;
  let role;
  try {
    if (joinCode) {
      company = await findCompanyByJoinCode(joinCode);
      if (!company) return res.status(400).json({ error: 'That join code doesn’t match any company. Check it with your admin.' });
      role = 'representative';
    } else {
      const { data: taken } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
      if (taken) return res.status(400).json({ error: 'An account with that email already exists' });
      company = await createCompany(companyName);
      role = 'admin';
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert([{ name, email, password_hash, role, company_id: company.id }])
    .select()
    .single();

  if (error) {
    if (!joinCode) await deleteCompany(company.id);
    return res.status(400).json({ error: error.message });
  }

  await mirrorUpsert('users', data);
  await recordAudit(data, 'auth.register', {
    entity: 'user',
    entityId: data.id,
    details: { role, ...(joinCode ? {} : { createdCompany: company.name }) },
  });
  const { id, name: savedName, email: savedEmail, role: savedRole } = data;
  return res.status(201).json({ user: { id, name: savedName, email: savedEmail, role: savedRole }, company: { id: company.id, name: company.name } });
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, password_hash, role, is_active, company_id')
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
  await loginLimiter.resetKey(emailOrIpKey(req));
  await recordAudit(user, 'auth.login', { entity: 'user', entityId: user.id });

  let company = null;
  try {
    company = await companyOf(user.company_id);
  } catch {
    // only used for display; the login itself has succeeded
  }
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, company },
  });
});

// POST /api/auth/forgot-password — body { email }. Always answers the same way so the
// form can't be used to find out which emails have accounts.
// SalesMesh has no email service yet, so outside production the reset link comes back in
// the response and the page goes straight to it; in production an admin issues the link
// from the account page instead.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
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
router.post('/reset-password', ipLimiter, async (req, res) => {
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
