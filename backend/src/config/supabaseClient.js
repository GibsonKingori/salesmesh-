import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    '[supabaseClient] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set them in backend/.env'
  );
}

// A request that never reaches Supabase (dropped Wi-Fi, a slow DNS lookup, a connect timeout)
// makes Node's fetch throw "TypeError: fetch failed", which supabase-js hands back as the error
// message. Reads are retried; writes only when the connection never opened, so a request that may
// have reached the database (e.g. an import's insert) is never sent twice.
const NEVER_SENT = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ENETUNREACH'];
const RETRIES = 2;

export async function fetchWithRetry(input, init = {}, attempt = 0) {
  try {
    return await fetch(input, init);
  } catch (err) {
    const code = err.cause?.code;
    const method = (init.method || 'GET').toUpperCase();
    const safe = ['GET', 'HEAD'].includes(method) || NEVER_SENT.includes(code);
    if (err.name !== 'TypeError' || !safe || attempt >= RETRIES || init.signal?.aborted) {
      console.error(`Supabase ${method} failed:`, err.cause ?? err);
      throw err;
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    return fetchWithRetry(input, init, attempt + 1);
  }
}

// Service-role client: used server-side only, bypasses RLS.
// Row-level security in Postgres still enforces role-based access
// for any client-side/anon-key usage, per the proposal's defense-in-depth design.
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
  global: { fetch: fetchWithRetry },
});
