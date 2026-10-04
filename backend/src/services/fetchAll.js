// Supabase (PostgREST) returns at most 1,000 rows per request, so a plain .select() on a
// big table silently stops at 1,000. fetchAll pages through until every row is read.
// `buildQuery` must return a fresh, ordered query each call (paging needs a stable order).
// Pages are requested a few at a time in parallel, so 9,000 rows take about two round trips.
// Returns { data, error } like a normal Supabase call.
export const PAGE_SIZE = 1000;
const PARALLEL_PAGES = 5;

export async function fetchAll(buildQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let first = 0; ; first += PARALLEL_PAGES) {
    const pages = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, (_, i) => {
        const from = (first + i) * pageSize;
        return buildQuery().range(from, from + pageSize - 1);
      })
    );
    for (const { data, error } of pages) {
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < pageSize) return { data: rows, error: null };
    }
  }
}
