import dotenv from 'dotenv';
import app from './app.js';
import { pool, mirrorState } from './config/postgresClient.js';
import { dataSource, dataSourceSetting, goOffline } from './config/dataSource.js';
import { syncAll } from './services/mirrorSync.js';
import { createMirrorHealer } from './services/mirrorHealer.js';
import {
  ensureJournal,
  pendingChanges,
  startConnectivityMonitor,
  supabaseReachable,
  syncWithOfflineChanges,
} from './services/offlineSync.js';

dotenv.config();

const PORT = process.env.PORT || 4000;

// With local PostgreSQL set up, the API keeps working without internet (see services/offlineSync.js)
if (pool) {
  try {
    await ensureJournal();
    const setting = dataSourceSetting();
    if (setting === 'local' || (setting === 'auto' && !(await supabaseReachable()))) {
      goOffline();
      console.warn(
        setting === 'local'
          ? '[offline] DATA_SOURCE=local: using the local PostgreSQL database'
          : '[offline] Supabase unreachable: starting on the local PostgreSQL database'
      );
    }
  } catch (err) {
    console.error('[offline] local PostgreSQL unavailable, so offline mode is off:', err.message);
  }
}

app.locals.databaseStatus = async () => ({
  source: dataSource.offline ? 'local' : 'supabase',
  offlineSince: dataSource.since,
  pendingChanges: pool ? await pendingChanges().catch(() => null) : 0,
});

const server = app.listen(PORT, () => {
  console.log(`SalesMesh API running on http://localhost:${PORT}`);
  if (!pool) return;

  const healer = createMirrorHealer({
    sync: syncWithOfflineChanges(syncAll),
    state: mirrorState,
    retryMs: Number(process.env.MIRROR_RETRY_SECONDS || 30) * 1000,
    fullSyncMs: Number(process.env.MIRROR_FULL_SYNC_MINUTES || 10) * 60_000,
  });
  app.locals.mirrorStatus = healer.status;
  if (dataSourceSetting() !== 'local') healer.start();
  startConnectivityMonitor({ healer });
  console.log('Local PostgreSQL mirror enabled — self-healing sync running');
});

// Reading a screenshot with a local AI model can take several minutes on a laptop; Node's
// default 5-minute request limit would cut it off
server.requestTimeout = 15 * 60 * 1000;
