import { jest } from '@jest/globals';
import { dataSource, goOnline } from '../config/dataSource.js';
import { startConnectivityMonitor, syncWithOfflineChanges } from './offlineSync.js';

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

test('no Supabase -> local sync while offline, so offline work is never overwritten', async () => {
  const syncAll = jest.fn();
  dataSource.offline = true;
  await expect(syncWithOfflineChanges(syncAll)()).rejects.toThrow(/offline/);
  expect(syncAll).not.toHaveBeenCalled();
});
