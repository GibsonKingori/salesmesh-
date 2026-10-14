// The supabase-js query builder, answered by local PostgreSQL instead of Supabase. Used while the
// API is offline (see config/dataSource.js), so the routes run unchanged. It covers the calls the
// routes make: select (with count, and one-level embeds like "deals(title)"), insert, upsert,
// update, delete; eq/neq/is/lt/lte/gt/gte/in/ilike/match filters; order, range, limit, single.
//
// Rows come back the way PostgREST renders them (row_to_json, UTC sessions), and a select returns
// at most 1,000 rows unless it asks for a range, like Supabase. Every write is also logged in
// offline_changes, in the same transaction, so services/offlineSync.js can send it to Supabase later.
import { PRIMARY_KEYS } from './postgresClient.js';

export const MAX_ROWS = 1000;
export const JOURNAL_TABLE = 'offline_changes';

const IDENT = /^[a-z_][a-z0-9_]*$/i;
function quote(ident) {
  if (!IDENT.test(ident)) throw new Error(`Invalid name "${ident}"`);
  return `"${ident}"`;
}

// "id, name, deals(title)" -> ['id', 'name', { embed: 'deals', columns: ['title'] }]
function parseColumns(spec = '*') {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of spec) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map((p) => {
    const embed = p.match(/^(\w+)\s*\(([^)]*)\)$/);
    if (!embed) return p;
    return { embed: embed[1], columns: embed[2].split(',').map((c) => c.trim()).filter(Boolean) };
  });
}

const columnList = (cols, alias) => (cols.length === 0 || cols.includes('*') ? `${alias}.*` : cols.map((c) => `${alias}.${quote(c)}`).join(', '));

// Select list for the outer table. An embed "deals(title)" on activities follows activities.deal_id
// to deals.id (many-to-one), as PostgREST does through the foreign key.
function selectList(parsed) {
  return parsed
    .map((p) => {
      if (typeof p === 'string') return p === '*' ? 't.*' : `t.${quote(p)}`;
      const fk = `${p.embed.replace(/s$/, '')}_id`;
      return `(select row_to_json(e) from (select ${columnList(p.columns, 'x')} from ${quote(p.embed)} x where x."id" = t.${quote(fk)}) e) as ${quote(p.embed)}`;
    })
    .join(', ');
}

// Writes return whole rows; this picks the requested columns from them
function pick(row, parsed) {
  if (parsed.includes('*')) return row;
  return Object.fromEntries(parsed.filter((p) => typeof p === 'string').map((c) => [c, row[c]]));
}

// jsonb values (audit_logs.details) are sent as JSON text; pg would turn arrays into Postgres arrays
const toParam = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

const asError = (err) => ({ message: err.message, code: err.code, details: err.detail ?? null, hint: err.hint ?? null });

export function createLocalSupabase(pool, { journal = true } = {}) {
  function builder(table) {
    quote(table);
    let op = 'select';
    let payload = null;
    let conflictKeys = null;
    let returning = false;
    let columns = parseColumns('*');
    let withCount = false;
    let mode = 'many';
    let rangeBounds = null;
    let limitTo = null;
    const orders = [];
    const filters = []; // (param) => sql

    function where(params) {
      if (!filters.length) return '';
      // raw: send the value as is (the id list for .in() must stay a Postgres array)
      const param = (v, raw = false) => {
        params.push(raw ? v : toParam(v));
        return `$${params.length}`;
      };
      return ` where ${filters.map((f) => f(param)).join(' and ')}`;
    }

    async function runSelect() {
      const params = [];
      const conditions = where(params);
      const orderSql = orders.length ? ` order by ${orders.join(', ')}` : '';
      let pageSql;
      if (rangeBounds) pageSql = ` offset ${rangeBounds[0]} limit ${rangeBounds[1] - rangeBounds[0] + 1}`;
      else pageSql = ` limit ${Math.min(limitTo ?? MAX_ROWS, MAX_ROWS)}`;
      const sql = `select row_to_json(r) as j from (select ${selectList(columns)} from ${quote(table)} t${conditions}${orderSql}${pageSql}) r`;
      const { rows } = await pool.query(sql, params);
      let count = null;
      if (withCount) {
        const countParams = [];
        const res = await pool.query(`select count(*)::int as n from ${quote(table)} t${where(countParams)}`, countParams);
        count = res.rows[0].n;
      }
      return { data: rows.map((r) => r.j), count };
    }

    function writeSql(params) {
      const param = (v) => {
        params.push(toParam(v));
        return `$${params.length}`;
      };
      if (op === 'insert' || op === 'upsert') {
        const cols = [...new Set(payload.flatMap((r) => Object.keys(r)))];
        if (!cols.length) return `insert into ${quote(table)} default values returning *`;
        // A key missing from one row gets the column default, not NULL
        const tuples = payload.map((r) => `(${cols.map((c) => (r[c] === undefined ? 'default' : param(r[c]))).join(', ')})`);
        let sql = `insert into ${quote(table)} as t (${cols.map(quote).join(', ')}) values ${tuples.join(', ')}`;
        if (op === 'upsert') {
          const keys = conflictKeys ?? [PRIMARY_KEYS[table] ?? 'id'];
          const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${quote(c)} = excluded.${quote(c)}`);
          sql += ` on conflict (${keys.map(quote).join(', ')}) ${updates.length ? `do update set ${updates.join(', ')}` : 'do nothing'}`;
        }
        return `${sql} returning t.*`;
      }
      if (op === 'update') {
        const sets = Object.entries(payload).map(([c, v]) => `${quote(c)} = ${param(v)}`);
        return `update ${quote(table)} as t set ${sets.join(', ')}${where(params)} returning t.*`;
      }
      return `delete from ${quote(table)} as t${where(params)} returning t.*`;
    }

    async function runWrite() {
      const params = [];
      const sql = `with w as (${writeSql(params)}) select row_to_json(w) as j from w`;
      const client = await pool.connect();
      try {
        await client.query('begin');
        const rows = (await client.query(sql, params)).rows.map((r) => r.j);
        const pk = PRIMARY_KEYS[table];
        if (journal && pk && rows.length) {
          await client.query(`insert into ${JOURNAL_TABLE} (table_name, row_id, op) select $1, unnest($2::text[]), $3`, [
            table,
            rows.map((r) => String(r[pk])),
            op === 'delete' ? 'delete' : 'upsert',
          ]);
        }
        await client.query('commit');
        return { data: returning ? rows.map((r) => pick(r, columns)) : null, count: null };
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    async function run() {
      try {
        let { data, count } = op === 'select' ? await runSelect() : await runWrite();
        if (mode !== 'many') {
          if (data.length > 1 || (data.length === 0 && mode === 'single')) {
            return {
              data: null,
              count,
              error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows` },
            };
          }
          data = data[0] ?? null;
        }
        return { data, count, error: null };
      } catch (err) {
        return { data: null, count: null, error: asError(err) };
      }
    }

    const filter = (sqlFor) => {
      filters.push(sqlFor);
      return api;
    };
    const api = {
      select(cols = '*', options = {}) {
        columns = parseColumns(cols);
        withCount = options.count === 'exact';
        if (op !== 'select') returning = true;
        return api;
      },
      insert(rows) {
        op = 'insert';
        payload = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      upsert(rows, { onConflict } = {}) {
        op = 'upsert';
        if (onConflict) conflictKeys = onConflict.split(',').map((k) => k.trim());
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
      eq: (col, val) => filter((p) => `t.${quote(col)} = ${p(val)}`),
      neq: (col, val) => filter((p) => `t.${quote(col)} <> ${p(val)}`),
      lt: (col, val) => filter((p) => `t.${quote(col)} < ${p(val)}`),
      lte: (col, val) => filter((p) => `t.${quote(col)} <= ${p(val)}`),
      gt: (col, val) => filter((p) => `t.${quote(col)} > ${p(val)}`),
      gte: (col, val) => filter((p) => `t.${quote(col)} >= ${p(val)}`),
      // SQL ILIKE: % and _ are wildcards unless escaped with a backslash, same as PostgREST
      ilike: (col, pattern) => filter((p) => `t.${quote(col)} ilike ${p(pattern)}`),
      is(col, val) {
        const literal = { null: 'null', true: 'true', false: 'false' }[String(val)];
        if (!literal) throw new Error(`.is() takes null, true or false, not ${val}`);
        return filter(() => `t.${quote(col)} is ${literal}`);
      },
      // Compared as text so a list of ids works for uuid and text columns alike
      in: (col, vals) => filter((p) => (vals.length ? `t.${quote(col)}::text = any(${p(vals.map(String), true)}::text[])` : 'false')),
      match(values) {
        Object.entries(values).forEach(([c, v]) => api.eq(c, v));
        return api;
      },
      order(col, { ascending = true, nullsFirst } = {}) {
        const nulls = nullsFirst === undefined ? '' : nullsFirst ? ' nulls first' : ' nulls last';
        orders.push(`t.${quote(col)} ${ascending ? 'asc' : 'desc'}${nulls}`);
        return api;
      },
      range(from, to) {
        rangeBounds = [Number(from), Number(to)];
        return api;
      },
      limit(n) {
        limitTo = Number(n);
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
        return run().then(resolve, reject);
      },
    };
    return api;
  }

  return { from: builder };
}
