// Minimal in-memory stand-in for the supabase-js query builder, covering the calls
// the routes make (select/insert/update/upsert/delete, eq/is/lt/gte/in/ilike filters, order, range,
// count, single).
// Route tests use it so they never touch the real Supabase project.
import { randomUUID } from 'node:crypto';

export function createFakeSupabase(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  const rowsOf = (table) => (tables[table] ??= []);

  function builder(table) {
    let op = 'select';
    let payload = null;
    let returning = false;
    let columns = '*';
    let mode = 'many';
    let withCount = false;
    let orderBy = null;
    let rangeBounds = null;
    const filters = [];

    const pick = (row) => {
      if (columns === '*') return { ...row };
      return Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
    };
    const matches = (row) => filters.every((f) => f(row));

    function run() {
      const all = rowsOf(table);
      let affected;
      if (op === 'insert') {
        affected = payload.map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
        all.push(...affected);
      } else if (op === 'upsert') {
        // Matches on "transition" for funnel_benchmarks, "id" everywhere else
        affected = payload.map((r) => {
          const key = 'transition' in r ? 'transition' : 'id';
          const existing = all.find((row) => r[key] !== undefined && row[key] === r[key]);
          if (existing) return Object.assign(existing, r);
          const row = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
          all.push(row);
          return row;
        });
      } else if (op === 'update') {
        affected = all.filter(matches);
        affected.forEach((r) => Object.assign(r, payload));
      } else if (op === 'delete') {
        affected = all.filter(matches);
        tables[table] = all.filter((r) => !matches(r));
      } else {
        affected = all.filter(matches);
      }

      if (orderBy) {
        const { col, ascending } = orderBy;
        affected = [...affected].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
      }
      const count = withCount ? affected.length : null;
      if (rangeBounds) affected = affected.slice(rangeBounds[0], rangeBounds[1] + 1);

      let data = op === 'select' || returning ? affected.map(pick) : null;
      if (mode === 'single' || mode === 'maybeSingle') {
        if (data.length === 0 && mode === 'single') return { data: null, error: { message: 'No rows found' } };
        data = data[0] ?? null;
      }
      return { data, count, error: null };
    }

    const api = {
      select(cols = '*', options = {}) {
        columns = cols;
        withCount = options.count === 'exact';
        if (op !== 'select') returning = true;
        return api;
      },
      insert(rows) {
        op = 'insert';
        payload = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      upsert(rows) {
        op = 'upsert';
        payload = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      update(values) {
        op = 'update';
        payload = values;
        return api;
      },
      delete() {
        op = 'delete';
        return api;
      },
      eq(col, val) {
        filters.push((r) => r[col] === val);
        return api;
      },
      is(col, val) {
        filters.push((r) => (r[col] ?? null) === val);
        return api;
      },
      lt(col, val) {
        filters.push((r) => r[col] < val);
        return api;
      },
      gte(col, val) {
        filters.push((r) => r[col] >= val);
        return api;
      },
      in(col, vals) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      // SQL ILIKE: % and _ are wildcards unless escaped with a backslash
      ilike(col, pattern) {
        const literal = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let source = '';
        for (let i = 0; i < pattern.length; i++) {
          const c = pattern[i];
          if (c === '\\') source += literal(pattern[++i]);
          else if (c === '%') source += '.*';
          else if (c === '_') source += '.';
          else source += literal(c);
        }
        const re = new RegExp(`^${source}$`, 'is');
        filters.push((r) => re.test(r[col] ?? ''));
        return api;
      },
      order(col, { ascending = true } = {}) {
        orderBy = { col, ascending };
        return api;
      },
      range(from, to) {
        rangeBounds = [from, to];
        return api;
      },
      single() {
        mode = 'single';
        return api;
      },
      maybeSingle() {
        mode = 'maybeSingle';
        return api;
      },
      then(resolve, reject) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return api;
  }

  return { from: builder, tables };
}
