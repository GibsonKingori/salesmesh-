// Background job that keeps local PostgreSQL in step with Supabase without anyone
// running `npm run db:sync` by hand. It resyncs:
//   - on startup, to catch anything missed while the API was down
//   - within retryMs of a failed mirror write (e.g. PostgreSQL was stopped)
//   - every fullSyncMs regardless, to pick up edits made in the Supabase dashboard
// A failed sync keeps the resync flag set, so it is retried on the next tick until it succeeds.

// Node reports a refused localhost connection as an AggregateError with an empty message
// (one failure each for ::1 and 127.0.0.1), so fall back to the inner errors or the code.
function describeError(err) {
  if (err?.message) return err.message;
  const inner = err?.errors?.map((e) => e.message || e.code).filter(Boolean);
  if (inner?.length) return [...new Set(inner)].join('; ');
  return err?.code || String(err) || 'unknown error';
}

export function createMirrorHealer({
  sync,
  state,
  retryMs = 30_000,
  fullSyncMs = 10 * 60_000,
  now = () => Date.now(),
  log = console,
}) {
  let timer = null;
  let running = null;
  let lastSyncAt = null;
  let lastError = null;

  async function runSync(reason) {
    if (running) return running;
    const writesAtStart = state.writes;
    state.needsResync = false;

    running = (async () => {
      try {
        await sync();
        if (lastError !== null) log.log(`[mirror healer] local PostgreSQL back in sync (${reason})`);
        lastError = null;
        lastSyncAt = now();
        // A write mirrored mid-sync may have been overwritten by the older snapshot; go again
        if (state.writes !== writesAtStart) state.needsResync = true;
      } catch (err) {
        state.needsResync = true;
        const message = describeError(err);
        // Log each distinct failure once rather than every retry
        if (message !== lastError) {
          log.error(`[mirror healer] sync failed, retrying every ${Math.round(retryMs / 1000)}s:`, message);
        }
        lastError = message;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function tick() {
    if (state.needsResync) return runSync('after failed write');
    if (lastSyncAt === null || now() - lastSyncAt >= fullSyncMs) return runSync('scheduled');
    return null;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, retryMs);
      timer.unref?.(); // never keep the process alive just for this
      runSync('startup');
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    tick,
    runSync,
    status() {
      return {
        inSync: !state.needsResync && lastError === null && lastSyncAt !== null,
        syncing: Boolean(running),
        lastSyncAt: lastSyncAt && new Date(lastSyncAt).toISOString(),
        lastError,
      };
    },
  };
}
