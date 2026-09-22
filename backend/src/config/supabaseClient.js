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

// Service-role client: used server-side only, bypasses RLS.
// Row-level security in Postgres still enforces role-based access
// for any client-side/anon-key usage, per the proposal's defense-in-depth design.
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
