import { jest } from '@jest/globals';
import { createMirrorHealer } from './mirrorHealer.js';

const MINUTE = 60_000;
const silentLog = { log: jest.fn(), error: jest.fn() };

function setup({ sync = jest.fn().mockResolvedValue() } = {}) {
  let clock = 0;
  const state = { needsResync: false, writes: 0 };
  const healer = createMirrorHealer({
    sync,
    state,
    retryMs: 30_000,
    fullSyncMs: 10 * MINUTE,
    now: () => clock,
    log: silentLog,
  });
  return { healer, state, sync, advance: (ms) => (clock += ms) };
}

beforeEach(() => {
  silentLog.log.mockClear();
  silentLog.error.mockClear();
});

test('first tick syncs, then waits for the full-sync interval', async () => {
  const { healer, sync, advance } = setup();

  await healer.tick();
  expect(sync).toHaveBeenCalledTimes(1);
  expect(healer.status().inSync).toBe(true);

  advance(9 * MINUTE);
  expect(healer.tick()).toBeNull();
  expect(sync).toHaveBeenCalledTimes(1);

  advance(1 * MINUTE);
  await healer.tick();
  expect(sync).toHaveBeenCalledTimes(2);
});

test('a failed mirror write triggers a resync on the next tick', async () => {
  const { healer, state, sync } = setup();
  await healer.tick();

  state.needsResync = true;
  expect(healer.status().inSync).toBe(false);
  await healer.tick();

  expect(sync).toHaveBeenCalledTimes(2);
  expect(state.needsResync).toBe(false);
  expect(healer.status().inSync).toBe(true);
});

test('keeps retrying while sync fails, logging the error once, then recovers', async () => {
  const sync = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
  const { healer, state } = setup({ sync });

  await healer.tick();
  await healer.tick();
  await healer.tick();
  expect(sync).toHaveBeenCalledTimes(3);
  expect(silentLog.error).toHaveBeenCalledTimes(1);
  expect(state.needsResync).toBe(true);
  expect(healer.status()).toMatchObject({ inSync: false, lastError: 'connect ECONNREFUSED 127.0.0.1:5432' });

  sync.mockResolvedValue();
  await healer.tick();
  expect(healer.status()).toMatchObject({ inSync: true, lastError: null });
  expect(silentLog.log).toHaveBeenCalledWith(expect.stringContaining('back in sync'));
});

test('a write that lands mid-sync schedules another sync', async () => {
  let finish;
  const sync = jest.fn(() => new Promise((resolve) => (finish = resolve)));
  const { healer, state } = setup({ sync });

  const run = healer.tick();
  state.writes++; // a route mirrored a row while the snapshot was being applied
  finish();
  await run;

  expect(state.needsResync).toBe(true);
});

test('overlapping triggers share one sync instead of running two', async () => {
  let finish;
  const sync = jest.fn(() => new Promise((resolve) => (finish = resolve)));
  const { healer } = setup({ sync });

  const first = healer.runSync('startup');
  const second = healer.runSync('after failed write');
  expect(healer.status().syncing).toBe(true);
  finish();
  await Promise.all([first, second]);

  expect(sync).toHaveBeenCalledTimes(1);
});

test('reports a readable error when Node gives an empty-message AggregateError', async () => {
  const refused = new AggregateError(
    [Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
    ''
  );
  const { healer } = setup({ sync: jest.fn().mockRejectedValue(refused) });

  await healer.tick();

  expect(healer.status()).toMatchObject({
    inSync: false,
    lastError: 'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
  });
});
