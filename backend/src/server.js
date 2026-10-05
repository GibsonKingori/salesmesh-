import dotenv from 'dotenv';
import app from './app.js';
import { pool, mirrorState } from './config/postgresClient.js';
import { syncAll } from './services/mirrorSync.js';
import { createMirrorHealer } from './services/mirrorHealer.js';

dotenv.config();

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`SalesMesh API running on http://localhost:${PORT}`);
  if (!pool) return;

  const healer = createMirrorHealer({
    sync: syncAll,
    state: mirrorState,
    retryMs: Number(process.env.MIRROR_RETRY_SECONDS || 30) * 1000,
    fullSyncMs: Number(process.env.MIRROR_FULL_SYNC_MINUTES || 10) * 60_000,
  });
  app.locals.mirrorStatus = healer.status;
  healer.start();
  console.log('Local PostgreSQL mirror enabled — self-healing sync running');
});

// Reading a screenshot with a local AI model can take several minutes on a laptop; Node's
// default 5-minute request limit would cut it off
server.requestTimeout = 15 * 60 * 1000;
