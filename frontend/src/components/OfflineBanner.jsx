import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { getOfflineSummary } from '../lib/offlineStore.js';
import { useAuth } from '../context/AuthContext.jsx';

const CHECK_EVERY_MS = 30_000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

export default function OfflineBanner() {
  const { user } = useAuth();
  const [database, setDatabase] = useState(null);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine !== false);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [offlineData, setOfflineData] = useState({ pendingChanges: 0, lastCachedAt: null });
  const [syncError, setSyncError] = useState(null);
  const [storageError, setStorageError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const refreshOfflineData = () => {
      if (!user?.id) return;
      getOfflineSummary(user.id)
        .then((summary) => !cancelled && setOfflineData(summary))
        .catch((error) => console.error('[offline] Could not read local sync status:', error));
    };
    const check = () => {
      setBrowserOnline(navigator.onLine !== false);
      if (navigator.onLine === false && !LOCAL_HOSTS.includes(window.location.hostname)) {
        setApiUnavailable(true);
        refreshOfflineData();
        return;
      }
      api
        .get('/health')
        .then((res) => {
          if (cancelled) return;
          setApiUnavailable(false);
          setDatabase(res.data.database ?? null);
        })
        .catch((error) => {
          if (cancelled) return;
          setApiUnavailable(!error.response || error.response.status >= 500);
        });
      refreshOfflineData();
    };
    const onOfflineState = (event) => {
      if (Object.hasOwn(event.detail || {}, 'syncError')) setSyncError(event.detail.syncError);
      if (event.detail?.storageError) setStorageError(event.detail.storageError);
      if (event.detail?.pendingChanges !== undefined) {
        setOfflineData((prev) => ({ ...prev, pendingChanges: event.detail.pendingChanges }));
      }
      if (event.detail?.browserOffline || event.detail?.usingCache) setApiUnavailable(true);
      refreshOfflineData();
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    window.addEventListener('salesmesh:offline-state', onOfflineState);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      window.removeEventListener('salesmesh:offline-state', onOfflineState);
    };
  }, [user?.id]);

  if (database?.source === 'local') {
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

  if (browserOnline && !apiUnavailable && offlineData.pendingChanges === 0 && !syncError && !storageError) return null;

  return (
    <div role="status" className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-center text-xs text-amber-900 dark:text-amber-200">
      <span className="font-semibold">
        {storageError ? 'Offline storage warning.' : offlineData.pendingChanges ? 'Offline changes saved.' : 'Offline mode.'}
      </span>{' '}
      {storageError
        ? 'This browser may not be able to save data for offline use.'
        : !browserOnline
        ? 'No internet connection. Showing this device’s last synced data.'
        : apiUnavailable
        ? 'The SalesMesh server cannot be reached. Showing this device’s last synced data.'
        : 'Saved changes are waiting to sync.'}
      {offlineData.lastCachedAt
        ? ` Last synced ${new Date(offlineData.lastCachedAt).toLocaleString()}.`
        : ' Connect once to sync data to this device before working offline.'}
      {offlineData.pendingChanges > 0
        ? ` ${offlineData.pendingChanges} change${offlineData.pendingChanges === 1 ? '' : 's'} waiting to sync.`
        : ''}
      {syncError ? ` A change could not sync: ${syncError}` : ''}
      {storageError ? ` Offline storage is unavailable: ${storageError}` : ''}
    </div>
  );
}
