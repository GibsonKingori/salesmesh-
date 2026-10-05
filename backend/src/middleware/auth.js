import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabaseClient.js';

// Each request re-reads the caller's account so a disabled account or a role change
// takes effect straight away instead of when the token expires. Results are cached
// briefly to avoid a database round trip on every call; admin changes clear the cache.
const ACCOUNT_CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 15 * 1000;
const accountCache = new Map(); // id -> { account, at }

export function forgetAccount(userId) {
  accountCache.delete(userId);
}

// A manager's account also carries the ids of the representatives assigned to them,
// which services/access.js uses to decide what the manager can see
async function loadAccount(userId) {
  const hit = accountCache.get(userId);
  if (hit && Date.now() - hit.at < ACCOUNT_CACHE_MS) return hit.account;
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, is_active, company_id, manager_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;

  let account = data;
  if (data?.role === 'manager') {
    const { data: team, error: teamError } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', data.company_id)
      .eq('manager_id', data.id);
    if (teamError) throw teamError;
    account = { ...data, teamIds: team.map((u) => u.id) };
  }
  accountCache.set(userId, { account, at: Date.now() });
  return account;
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  let account;
  try {
    account = await loadAccount(payload.id);
  } catch (err) {
    return res.status(503).json({ error: 'Could not check your account, please try again' });
  }
  if (!account) {
    return res.status(401).json({ error: 'Account no longer exists' });
  }
  if (account.is_active === false) {
    return res.status(401).json({ error: 'Your account has been disabled. Contact your administrator.', code: 'account_disabled' });
  }

  // { id, name, email, role, company_id, manager_id, teamIds? }, all current from the database
  req.user = {
    ...payload,
    name: account.name,
    role: account.role,
    company_id: account.company_id,
    manager_id: account.manager_id ?? null,
    teamIds: account.teamIds ?? [],
  };
  next();
}

// Usage: requireRole('manager') or requireRole('manager', 'admin')
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient role permissions' });
    }
    next();
  };
}
