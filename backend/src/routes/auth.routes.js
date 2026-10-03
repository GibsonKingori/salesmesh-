import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabaseClient.js';
import rateLimit from 'express-rate-limit';
import { mirrorUpsert } from '../config/postgresClient.js';

const router = express.Router();

export const MIN_PASSWORD_LENGTH = 8;

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

// POST /api/auth/register — public sign-up always creates a representative.
// Managers and admins are promoted by an admin via PATCH /api/users/:id/role,
// so nobody can grant themselves elevated access.
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert([{ name, email, password_hash, role: 'representative' }])
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  await mirrorUpsert('users', data);
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
    .select('id, name, email, password_hash, role')
    .eq('email', email)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

export default router;
