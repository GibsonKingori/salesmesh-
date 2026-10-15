import React, { useEffect, useState } from 'react';
import api from '../api/client.js';

const CHECK_EVERY_MS = 30_000;

// Shown while the API has no internet and is working from the local PostgreSQL copy. Changes made
// meanwhile are saved locally and sent to Supabase automatically once the connection is back.
export default function OfflineBanner() {
  const [database, setDatabase] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .get('/health')
        .then((res) => !cancelled && setDatabase(res.data.database ?? null))
        .catch(() => {});
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (database?.source !== 'local') return null;
  const pending = database.pendingChanges;
  return (
    <div role="status" className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-center text-xs text-amber-900 dark:text-amber-200">
      <span className="font-semibold">Offline mode.</span> SalesMesh is using the copy of your data on this computer.
      {pending > 0
        ? ` ${pending} change${pending === 1 ? '' : 's'} will be sent to the cloud when the internet is back.`
        : ' Anything you change will be sent to the cloud when the internet is back.'}
    </div>
  );
}
