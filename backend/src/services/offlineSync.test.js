import { jest } from '@jest/globals';
import { dataSource, goOnline } from '../config/dataSource.js';
import { ensureOfflineSchema, startConnectivityMonitor, syncWithOfflineChanges } from './offlineSync.js';

const quiet = { log: () => {}, warn: () => {} };

afterEach(() => {
  goOnline();
  delete process.env.DATA_SOURCE;
});

test('switches to local PostgreSQL when Supabase is unreachable, and back when it answers', async () => {
  let online = false;
  const healer = { runSync: jest.fn() };
  const monitor = startConnectivityMonitor({ healer, reachable: async () => online, log: quiet });

  await monitor.check();
  expect(dataSource.offline).toBe(true);
  expect(healer.runSync).not.toHaveBeenCalled();

  online = true;
  await monitor.check();
  expect(dataSource.offline).toBe(false);
  // The healer's sync sends the offline changes before copying Supabase down
  expect(healer.runSync).toHaveBeenCalledWith('back online');
  monitor.stop();
});

test('DATA_SOURCE=supabase never switches', async () => {
  process.env.DATA_SOURCE = 'supabase';
  const monitor = startConnectivityMonitor({ reachable: async () => false, log: quiet });
  expect(monitor.check).toBeUndefined();
  expect(dataSource.offline).toBe(false);
});

test('upgrades local pipeline settings columns before enabling offline mode', async () => {
  const client = { query: jest.fn().mockResolvedValue({}) };

  await ensureOfflineSchema(client);

  expect(client.query).toHaveBeenCalledWith('alter table companies add column if not exists pipeline_stages jsonb');
  expect(client.query).toHaveBeenCalledWith("alter table companies add column if not exists deal_fields jsonb not null default '[]'::jsonb");
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('create table if not exists offline_changes'));
});

test('no Supabase -> local sync while offline, so offline work is never overwritten', async () => {
  const syncAll = jest.fn();
  dataSource.offline = true;
  await expect(syncWithOfflineChanges(syncAll)()).rejects.toThrow(/offline/);
  expect(syncAll).not.toHaveBeenCalled();
});
