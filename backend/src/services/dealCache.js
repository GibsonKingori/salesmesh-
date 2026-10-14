// Every dashboard, the priority list and the board need all of the deals a user may see, and
// reading thousands of rows from Supabase takes seconds. So each company's deals are read once
// and kept in memory for a short time; a manager's dashboard firing two requests at once also
// shares a single read. Any write through the API (config/postgresClient.js mirrorUpsert /
// mirrorDelete) clears the cache, so users always see their own changes straight away. Edits
// made in the Supabase dashboard show up within CACHE_MS.
import { supabase } from '../config/supabaseClient.js';
import { fetchAll } from './fetchAll.js';
import { visibleOwnerIds } from './access.js';

// Off in tests, which change the fake database directly between requests
const CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 30 * 1000;
const cache = new Map(); // company_id -> { at, promise }
let generation = 0;

// Deleting a contact, campaign or user unlinks it from deals, so those writes clear deals too
const AFFECTS_DEALS = new Set(['deals', 'contacts', 'campaigns', 'users']);

export function forgetDeals(table) {
  if (table && !AFFECTS_DEALS.has(table)) return;
  generation++;
  cache.clear();
}

function companyDeals(companyId) {
  const hit = cache.get(companyId);
  if (hit && (hit.at === null || Date.now() - hit.at < CACHE_MS)) return hit.promise;

  const startedIn = generation;
  const entry = { at: null };
  entry.promise = fetchAll(() => supabase.from('deals').select('*').eq('company_id', companyId).order('id')).then((result) => {
    // Keep a successful read only if nothing was written while it was in flight
    if (result.error || startedIn !== generation || !CACHE_MS) {
      if (cache.get(companyId) === entry) cache.delete(companyId);
    } else entry.at = Date.now();
    return result;
  });
  if (CACHE_MS) cache.set(companyId, entry);
  return entry.promise;
}

// { data, error } like fetchAll: the deals the user may see (services/access.js), ordered by id.
// The rows are shared between requests, so callers must copy rather than change them.
export async function visibleDeals(user) {
  const { data, error } = await companyDeals(user.company_id);
  if (error) return { data: null, error };
  const owners = visibleOwnerIds(user);
  return { data: owners ? data.filter((d) => owners.includes(d.owner_id)) : data, error: null };
}

// Newest first, id breaking ties, like the deal list queries
export const newestFirst = (field = 'created_at') => (a, b) =>
  Date.parse(b[field]) - Date.parse(a[field]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
