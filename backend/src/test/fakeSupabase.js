// Minimal in-memory stand-in for the supabase-js query builder, covering the calls
// the routes make (select/insert/update/upsert/delete, eq/in filters, order, single).
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
      } else if (op === 'update') {
        affected = all.filter(matches);
        affected.forEach((r) => Object.assign(r, payload));
      } else if (op === 'delete') {
        affected = all.filter(matches);
        tables[table] = all.filter((r) => !matches(r));
      } else {
        affected = all.filter(matches);
      }

      let data = op === 'select' || returning ? affected.map(pick) : null;
      if (mode === 'single' || mode === 'maybeSingle') {
        if (data.length === 0 && mode === 'single') return { data: null, error: { message: 'No rows found' } };
        data = data[0] ?? null;
      }
      return { data, error: null };
    }

    const api = {
      select(cols = '*') {
        columns = cols;
        if (op !== 'select') returning = true;
        return api;
      },
      insert(rows) {
        op = 'insert';
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
      in(col, vals) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      order() {
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
