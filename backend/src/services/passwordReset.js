import crypto from 'crypto';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert } from '../config/postgresClient.js';

export const RESET_TOKEN_MINUTES = 30;

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Creates a single-use reset token for a user and returns the frontend path that uses it.
// Any older unused tokens for the same user stop working, so only the newest link is valid.
export async function createResetToken(userId, createdBy = null) {
  const now = new Date().toISOString();
  const { data: retired, error: retireError } = await supabase
    .from('password_resets')
    .update({ used_at: now })
    .eq('user_id', userId)
    .is('used_at', null)
    .select();
  if (retireError) throw retireError;
  if (retired.length) await mirrorUpsert('password_resets', retired);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('password_resets')
    .insert([{ user_id: userId, token_hash: hashToken(token), expires_at: expiresAt, created_by: createdBy }])
    .select()
    .single();
  if (error) throw error;
  await mirrorUpsert('password_resets', data);

  return { resetPath: `/reset-password?token=${token}`, expiresAt };
}

// Returns the reset row if the token is unused and unexpired, otherwise null
export async function findUsableReset(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const { data, error } = await supabase.from('password_resets').select('*').eq('token_hash', hashToken(token)).maybeSingle();
  if (error) throw error;
  if (!data || data.used_at || new Date(data.expires_at) < new Date()) return null;
  return data;
}
