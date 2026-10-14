// Which database the API is using right now. Online, Supabase is the source of truth and local
// PostgreSQL is its mirror. Offline (no internet), the routes read and write local PostgreSQL
// directly and every change is logged, so it can be sent to Supabase once the connection is back
// (see services/offlineSync.js). No imports here, so any module can read it without a cycle.
// DATA_SOURCE in backend/.env:
//   auto (default) — Supabase while it can be reached, local PostgreSQL when it can't
//   supabase       — never go offline
//   local          — always use local PostgreSQL (changes are still logged for Supabase)
export const dataSourceSetting = () => {
  const value = (process.env.DATA_SOURCE || 'auto').toLowerCase();
  return ['auto', 'supabase', 'local'].includes(value) ? value : 'auto';
};
export const offlineAllowed = () => dataSourceSetting() !== 'supabase';

export const dataSource = {
  offline: false,
  since: null, // when the current offline spell started (ISO string)
};

export function goOffline() {
  if (dataSource.offline) return false;
  dataSource.offline = true;
  dataSource.since = new Date().toISOString();
  return true;
}

export function goOnline() {
  if (!dataSource.offline) return false;
  dataSource.offline = false;
  dataSource.since = null;
  return true;
}
