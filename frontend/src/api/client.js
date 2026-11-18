import axios from 'axios';
import {
  applyQueuedMutationToCache,
  cacheApiResponse,
  createQueuedMutation,
  getOfflineSummary,
  getOfflineResponse,
  getQueuedMutations,
  removeQueuedMutation,
} from '../lib/offlineStore.js';

const api = axios.create({
  baseURL: '/api',
});

const OFFLINE_EVENT = 'salesmesh:offline-state';
let queueSync;
const priming = new Map();

function canContactServer() {
  return navigator.onLine !== false || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem('salesmesh_user') || 'null');
  } catch {
    return null;
  }
}

function requestUrl(config) {
  return api.getUri(config);
}

function requestPath(config) {
  return new URL(requestUrl(config), window.location.origin).pathname;
}

function setHeader(config, name, value) {
  if (typeof config.headers?.set === 'function') config.headers.set(name, value);
  else {
    config.headers = config.headers || {};
    config.headers[name] = value;
  }
}

function getHeader(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function isIdempotentCreate(config) {
  return config.method?.toLowerCase() === 'post' && ['/api/deals', '/api/contacts', '/api/campaigns', '/api/activities'].includes(requestPath(config));
}

function isCacheableGet(config) {
  if (config.method?.toLowerCase() !== 'get') return false;
  return /^\/api\/(deals(?:\/priority|\/imports)?|contacts|campaigns|activities|analytics\/(?:me|pipeline|campaigns(?:\/me)?)|settings\/(?:pipeline|deal-fields|benchmarks)|users\/team)$/.test(
    requestPath(config)
  );
}

function mutationFor(config) {
  const method = config.method.toUpperCase();
  const path = requestPath(config);
  const supported =
    (method === 'POST' && ['/api/deals', '/api/contacts', '/api/campaigns', '/api/activities'].includes(path)) ||
    (['PATCH', 'DELETE'].includes(method) && /^\/api\/(?:deals|contacts|activities)\/[^/]+$/.test(path));
  if (!supported) return null;
  return {
    method,
    url: config.url,
    baseURL: config.baseURL,
    params: config.params,
    data: config.data,
    cacheUrl: requestUrl(config),
    idempotencyKey: getHeader(config.headers, 'Idempotency-Key'),
  };
}

function unavailableOffline(error, message) {
  const result = error || new Error(message);
  result.message = message;
  result.response = {
    status: 503,
    data: { error: message },
    config: result.config,
  };
  return result;
}

function dispatchOfflineState(detail = {}) {
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, { detail }));
}

function optimisticResponse(config, queued) {
  const path = requestPath(config);
  const method = config.method.toLowerCase();
  const resourceMatch = path.match(/^\/api\/(deals|contacts|campaigns|activities)(?:\/|$)/);
  const resource = resourceMatch?.[1];
  if (method === 'delete') return { status: 202, data: null };
  if (!resource) return { status: 202, data: null };
  const singular = resource === 'activities' ? 'activity' : resource.slice(0, -1);
  return { status: 202, data: { [singular]: queued.record } };
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('salesmesh_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (isCacheableGet(config) || mutationFor(config)) config.timeout = 15_000;
  if (isIdempotentCreate(config) && !getHeader(config.headers, 'Idempotency-Key')) {
    setHeader(config, 'Idempotency-Key', crypto.randomUUID());
  }
  return config;
});

api.interceptors.response.use(
  async (response) => {
    if (isCacheableGet(response.config)) {
      const user = currentUser();
      if (user?.id) {
        await cacheApiResponse(user.id, requestUrl(response.config), response.data).catch((error) => {
          console.error('[offline] Could not cache this response:', error);
          dispatchOfflineState({ storageError: error.message });
        });
      }
    }
    return response;
  },
  (error) => {
    const isAuthCall = error.config?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && !isAuthCall && localStorage.getItem('salesmesh_token')) {
      localStorage.removeItem('salesmesh_token');
      localStorage.removeItem('salesmesh_user');
      window.location.assign(error.response.data?.code === 'account_disabled' ? '/login?disabled=1' : '/login?expired=1');
    }
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config || error.response || config.skipOfflineQueue) return Promise.reject(error);

    const user = currentUser();
    if (!user?.id) return Promise.reject(error);

    try {
      if (isCacheableGet(config)) {
        const cached = await getOfflineResponse(user, requestUrl(config));
        if (cached) {
          dispatchOfflineState({ usingCache: true });
          return {
            data: cached.data,
            status: 200,
            statusText: 'OK (offline cache)',
            headers: {},
            config,
            request: null,
          };
        }
        return Promise.reject(unavailableOffline(error, 'This data is not available offline yet. Open this page while connected to sync it to this device.'));
      }

      const mutation = mutationFor(config);
      if (mutation) {
        const queued = await createQueuedMutation(user, mutation);
        const optimistic = optimisticResponse(config, queued);
        const summary = await getOfflineSummary(user.id);
        dispatchOfflineState({ pendingChanges: summary.pendingChanges, queued: true, usingCache: true });
        return {
          data: optimistic.data,
          status: optimistic.status,
          statusText: 'Queued for sync',
          headers: {},
          config,
          request: null,
        };
      }

      return Promise.reject(unavailableOffline(error, 'This action requires an internet connection and was not saved.'));
    } catch (offlineError) {
      return Promise.reject(unavailableOffline(error, offlineError.message || 'Offline data could not be saved.'));
    }
  }
);

async function syncOfflineQueue() {
  const user = currentUser();
  if (!user?.id || !canContactServer() || queueSync) return queueSync;

  queueSync = (async () => {
    const queued = await getQueuedMutations(user.id);
    dispatchOfflineState({ pendingChanges: queued.length, syncing: queued.length > 0, syncError: null });
    for (const item of queued) {
      try {
        const response = await api.request({
          method: item.method,
          url: item.url,
          baseURL: item.baseURL,
          params: item.params,
          data: item.data,
          headers: { 'Idempotency-Key': item.idempotencyKey },
          skipOfflineQueue: true,
        });
        await applyQueuedMutationToCache(user, item, response.data);
        await removeQueuedMutation(item.id);
      } catch (error) {
        if (error.response?.status === 404 && item.method === 'DELETE') {
          await removeQueuedMutation(item.id);
          continue;
        }
        console.error('[offline] Could not sync a queued change:', error);
        dispatchOfflineState({
          pendingChanges: (await getOfflineSummary(user.id)).pendingChanges,
          syncing: false,
          syncError: error.response?.data?.error || error.message,
        });
        return;
      }
    }
  })()
    .catch((error) => {
      console.error('[offline] Could not process queued changes:', error);
      dispatchOfflineState({ syncing: false, syncError: error.message });
    })
    .finally(async () => {
      queueSync = null;
      const summary = await getOfflineSummary(user.id).catch((error) => {
        console.error('[offline] Could not read sync status:', error);
        return { pendingChanges: 0 };
      });
      dispatchOfflineState({ pendingChanges: summary.pendingChanges, syncing: false });
    });

  return queueSync;
}

export async function primeOfflineCache(user) {
  if (!user?.id || !canContactServer()) return;
  if (priming.has(user.id)) return priming.get(user.id);

  const paths = [
    '/deals',
    '/deals/priority',
    '/deals/imports',
    '/contacts',
    '/campaigns',
    '/settings/pipeline',
    '/settings/deal-fields',
    '/settings/benchmarks',
    user.role === 'representative' ? '/analytics/me' : '/analytics/pipeline',
    user.role === 'representative' ? '/analytics/campaigns/me' : '/analytics/campaigns',
  ];
  if (['manager', 'admin'].includes(user.role)) paths.push('/users/team');

  const operation = (async () => {
    await syncOfflineQueue();
    const results = await Promise.allSettled(paths.map((path) => api.get(path)));
    results.forEach((result, index) => {
      if (result.status === 'rejected' && !result.reason.response) {
        console.error(`[offline] Could not sync ${paths[index]} to this device:`, result.reason);
      }
    });
    const dealsResult = results[0];
    if (dealsResult.status === 'fulfilled') {
      const deals = dealsResult.value.data.deals || [];
      const batchSize = 5;
      for (let i = 0; i < deals.length; i += batchSize) {
        const batch = deals.slice(i, i + batchSize);
        await Promise.allSettled(batch.map((deal) => api.get('/activities', { params: { deal_id: deal.id } })));
      }
    }
  })().finally(() => priming.delete(user.id));
  priming.set(user.id, operation);
  return operation;
}

window.addEventListener('online', syncOfflineQueue);
window.addEventListener('offline', () => dispatchOfflineState({ browserOffline: true }));
window.setInterval(() => {
  if (canContactServer()) syncOfflineQueue();
}, 30_000);
window.setTimeout(() => {
  if (canContactServer()) syncOfflineQueue();
}, 0);

export default api;
