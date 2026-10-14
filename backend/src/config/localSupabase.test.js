// Runs against a real PostgreSQL: set TEST_DATABASE_URL (CI starts one). Everything happens in a
// throwaway schema, so any database will do. Skipped when TEST_DATABASE_URL isn't set.
import pg from 'pg';
import { createLocalSupabase, MAX_ROWS } from './localSupabase.js';

const url = process.env.TEST_DATABASE_URL;
const SCHEMA = `local_supabase_test_${process.pid}`;
const describeDb = url ? describe : describe.skip;

describeDb('local PostgreSQL in place of Supabase', () => {
  let pool;
  let db;

  beforeAll(async () => {
    const setup = new pg.Client({ connectionString: url });
    await setup.connect();
    await setup.query(`create schema ${SCHEMA}`);
    await setup.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${SCHEMA} -c timezone=UTC` });
    await pool.query(`
      create table deals (
        id uuid primary key default gen_random_uuid(),
        title text not null,
        value numeric(14,2) not null default 0,
        stage text not null default 'lead',
        owner_id text,
        created_at timestamptz not null default now()
      );
      create table activities (
        id uuid primary key default gen_random_uuid(),
        deal_id uuid references deals(id) on delete cascade,
        notes text
      );
      create table audit_logs (id uuid primary key default gen_random_uuid(), details jsonb);
      create table offline_changes (
        seq bigserial primary key, table_name text not null, row_id text not null, op text not null,
        created_at timestamptz not null default now()
      );`);
    db = createLocalSupabase(pool);
  });

  afterAll(async () => {
    await pool?.query(`drop schema ${SCHEMA} cascade`);
    await pool?.end();
  });

  beforeEach(() => pool.query('truncate deals, activities, audit_logs, offline_changes cascade'));

  test('insert returns rows shaped like PostgREST, and logs the change', async () => {
    const { data, error } = await db.from('deals').insert([{ title: 'Sofa', value: 45000 }]).select().single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ title: 'Sofa', value: 45000, stage: 'lead' });
    expect(data.created_at).toMatch(/^\d{4}-\d\d-\d\dT.*\+00:00$/);
    const { rows } = await pool.query('select table_name, row_id, op from offline_changes');
    expect(rows).toEqual([{ table_name: 'deals', row_id: data.id, op: 'upsert' }]);
  });

  test('filters, order, range and count', async () => {
    await db.from('deals').insert([
      { title: 'A', value: 10, stage: 'won', owner_id: 'u1' },
      { title: 'B', value: 20, stage: 'won', owner_id: 'u2' },
      { title: 'C', value: 30, stage: 'lost', owner_id: 'u1' },
      { title: 'D%', value: 40, stage: 'lead', owner_id: null },
    ]);
    const won = await db.from('deals').select('title', { count: 'exact' }).eq('stage', 'won').order('value', { ascending: false });
    expect(won.data).toEqual([{ title: 'B' }, { title: 'A' }]);
    expect(won.count).toBe(2);

    const page = await db.from('deals').select('title', { count: 'exact' }).order('title').range(1, 2);
    expect(page.data.map((d) => d.title)).toEqual(['B', 'C']);
    expect(page.count).toBe(4);

    expect((await db.from('deals').select('title').in('owner_id', ['u1']).order('title')).data).toEqual([{ title: 'A' }, { title: 'C' }]);
    expect((await db.from('deals').select('title').in('owner_id', [])).data).toEqual([]);
    expect((await db.from('deals').select('title').is('owner_id', null)).data).toEqual([{ title: 'D%' }]);
    expect((await db.from('deals').select('title').gte('value', 20).lt('value', 40).order('value')).data).toEqual([{ title: 'B' }, { title: 'C' }]);
    expect((await db.from('deals').select('title').ilike('title', 'd\\%')).data).toEqual([{ title: 'D%' }]);
  });

  test(`a select without a range returns at most ${MAX_ROWS} rows, like Supabase`, async () => {
    await pool.query(`insert into deals (title) select 'x' from generate_series(1, ${MAX_ROWS + 5})`);
    expect((await db.from('deals').select('id')).data).toHaveLength(MAX_ROWS);
    expect((await db.from('deals').select('id').range(MAX_ROWS, MAX_ROWS + 99)).data).toHaveLength(5);
  });

  test('embeds a parent row, as PostgREST does through the foreign key', async () => {
    const { data: deal } = await db.from('deals').insert({ title: 'Sofa' }).select().single();
    await db.from('activities').insert({ deal_id: deal.id, notes: 'called' });
    const { data } = await db.from('activities').select('notes, deals(title)');
    expect(data).toEqual([{ notes: 'called', deals: { title: 'Sofa' } }]);
  });

  test('update, upsert and delete', async () => {
    const { data: deal } = await db.from('deals').insert({ title: 'Sofa' }).select().single();
    const updated = await db.from('deals').update({ stage: 'won' }).eq('id', deal.id).select('stage');
    expect(updated.data).toEqual([{ stage: 'won' }]);

    await db.from('deals').upsert([{ id: deal.id, title: 'Sofa set' }]);
    expect((await db.from('deals').select('title, stage').eq('id', deal.id).single()).data).toEqual({ title: 'Sofa set', stage: 'won' });

    const removed = await db.from('deals').delete().eq('id', deal.id);
    expect(removed).toMatchObject({ data: null, error: null });
    const { rows } = await pool.query("select op from offline_changes where row_id = $1 order by seq", [deal.id]);
    expect(rows.map((r) => r.op)).toEqual(['upsert', 'upsert', 'upsert', 'delete']);
  });

  test('jsonb values are stored as JSON, including arrays', async () => {
    const { data } = await db.from('audit_logs').insert({ details: { changed: ['stage', 'value'] } }).select().single();
    expect(data.details).toEqual({ changed: ['stage', 'value'] });
  });

  test('errors come back like Supabase errors instead of throwing', async () => {
    const missing = await db.from('deals').select('*').eq('id', '00000000-0000-0000-0000-000000000000').single();
    expect(missing).toMatchObject({ data: null, error: { code: 'PGRST116' } });
    expect((await db.from('deals').select('*').eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle()).data).toBeNull();

    const bad = await db.from('deals').insert({ title: null });
    expect(bad.error).toMatchObject({ code: '23502' });
    const { rows } = await pool.query('select count(*)::int as n from offline_changes');
    expect(rows[0].n).toBe(0); // a failed write logs nothing
  });

  test('rejects names that could inject SQL', () => {
    expect(() => db.from('deals; drop table deals')).toThrow(/Invalid name/);
    expect(() => db.from('deals').eq('id"; --', 1)).not.toThrow(); // quoted when the query runs...
    return expect(db.from('deals').select('*').eq('id"; --', 1)).resolves.toMatchObject({ error: { message: expect.stringMatching(/Invalid name/) } });
  });
});
