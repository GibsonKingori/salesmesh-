// Search, filter and pagination options for the deal list endpoints.
// Every option is optional; with none, the endpoints return every deal the user may see.

export const STATUS_STAGES = {
  open: ['lead', 'qualified', 'proposal', 'negotiation'],
  closed: ['won', 'lost'],
};

export const MAX_PAGE_SIZE = 100;

// Turns query-string values into { filters, page } or { error }.
// page is null when no limit was asked for (= no pagination).
export function parseDealQuery(query, user) {
  const filters = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) filters.q = q.slice(0, 100);

  if (query.status !== undefined) {
    if (!STATUS_STAGES[query.status]) return { error: 'status must be open or closed' };
    filters.status = query.status;
  }

  // Reps only ever see their own deals, so an owner filter means nothing for them
  if (query.owner_id && user.role !== 'representative') filters.owner_id = String(query.owner_id);
  if (query.campaign_id) filters.campaign_id = String(query.campaign_id);

  let page = null;
  if (query.limit !== undefined || query.offset !== undefined) {
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      return { error: `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}` };
    }
    if (!Number.isInteger(offset) || offset < 0) return { error: 'offset must be a whole number, 0 or more' };
    page = { limit, offset };
  }

  return { filters, page };
}

// ILIKE pattern for "title contains s". % and _ are wildcards in ILIKE, so they're escaped to
// match literally. Supabase's REST layer also treats * as %, and won't accept it escaped, so
// * becomes _ (exactly one character of any kind) instead.
export const likePattern = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_')}%`;

// Applies the filters to a supabase-js deals query
export function applyDealFilters(query, filters) {
  if (filters.q) query = query.ilike('title', likePattern(filters.q));
  if (filters.status) query = query.in('stage', STATUS_STAGES[filters.status]);
  if (filters.owner_id) query = query.eq('owner_id', filters.owner_id);
  if (filters.campaign_id) query = query.eq('campaign_id', filters.campaign_id);
  return query;
}

// Same filters for deals already in memory (the priority list is ranked before filtering,
// so a deal's score doesn't depend on what the user searched for)
export function matchesDealFilters(deal, filters) {
  if (filters.q && !deal.title?.toLowerCase().includes(filters.q.toLowerCase())) return false;
  if (filters.status && !STATUS_STAGES[filters.status].includes(deal.stage)) return false;
  if (filters.owner_id && deal.owner_id !== filters.owner_id) return false;
  if (filters.campaign_id && deal.campaign_id !== filters.campaign_id) return false;
  return true;
}
