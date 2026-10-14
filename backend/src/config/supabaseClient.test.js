import { jest } from '@jest/globals';
import { fetchWithRetry } from './supabaseClient.js';
import { dbErrorMessage } from '../services/dbErrors.js';

const realFetch = global.fetch;
const networkError = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const ok = { ok: true, status: 200 };

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

test('a read that drops is tried again', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(networkError('ECONNRESET')).mockResolvedValueOnce(ok);
  await expect(fetchWithRetry('https://db/rest/v1/deals')).resolves.toBe(ok);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a write is retried only when the connection never opened', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(networkError('UND_ERR_CONNECT_TIMEOUT')).mockResolvedValueOnce(ok);
  await expect(fetchWithRetry('https://db/rest/v1/deals', { method: 'POST' })).resolves.toBe(ok);

  // The insert may have reached the database: sending it again could save the deals twice
  global.fetch = jest.fn().mockRejectedValue(networkError('ECONNRESET'));
  await expect(fetchWithRetry('https://db/rest/v1/deals', { method: 'POST' })).rejects.toThrow('fetch failed');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('gives up after a few tries', async () => {
  global.fetch = jest.fn().mockRejectedValue(networkError('ENOTFOUND'));
  await expect(fetchWithRetry('https://db/rest/v1/deals')).rejects.toThrow('fetch failed');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('"fetch failed" is explained to the user', () => {
  expect(dbErrorMessage({ message: 'TypeError: fetch failed' })).toMatch(/Couldn't reach the database/);
  expect(dbErrorMessage({ message: 'duplicate key' })).toBe('duplicate key');
});
