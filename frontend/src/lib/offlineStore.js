const DB_NAME = 'salesmesh-offline';
const DB_VERSION = 1;
const RESPONSE_STORE = 'responses';
const MUTATION_STORE = 'mutations';

let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Offline storage is not available in this browser.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RESPONSE_STORE)) database.createObjectStore(RESPONSE_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(MUTATION_STORE)) database.createObjectStore(MUTATION_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline storage.'));
    request.onblocked = () => reject(new Error('Offline storage is blocked by another open SalesMesh tab.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

function transact(storeName, mode, action) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error || new Error('Offline storage transaction failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction was aborted.'));
      })
  );
}

const userKey = (userId, value) => `${userId}\n${value}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const allByUser = (storeName, userId) => transact(storeName, 'readonly', (store) => store.getAll()).then((rows) => rows.filter((row) => row.userId === userId));

export async function cacheApiResponse(userId, url, data) {
  const parsed = new URL(url, window.location.origin);
  if (/^\/api\/deals(?:\/priority)?$/.test(parsed.pathname) && parsed.search) return;
  const record = {
    key: userKey(userId, `${parsed.pathname}${parsed.search}`),
    userId,
    url: `${parsed.pathname}${parsed.search}`,
    path: parsed.pathname,
    data: clone(data),
    savedAt: Date.now(),
  };
  await transact(RESPONSE_STORE, 'readwrite', (store) => store.put(record));
}

function getResource(path) {
  if (path === '/api/deals' || path === '/api/deals/priority') return 'deals';
  if (path === '/api/contacts') return 'contacts';
  if (path === '/api/campaigns') return 'campaigns';
  if (path === '/api/activities') return 'activities';
  return null;
}

function getMutationTarget(mutation) {
  const url = new URL(mutation.cacheUrl, window.location.origin);
  const path = url.pathname;
  const method = mutation.method.toUpperCase();
  const creates = {
    '/api/deals': 'deals',
    '/api/contacts': 'contacts',
    '/api/campaigns': 'campaigns',
    '/api/activities': 'activities',
  };
  if (method === 'POST' && creates[path]) return { resource: creates[path], action: 'create', id: mutation.record?.id };

  const match = path.match(/^\/api\/(deals|contacts|activities)\/([^/]+)$/);
  if (!match) return null;
  if (method === 'PATCH' && match[1] !== 'activities') return { resource: match[1], action: 'update', id: match[2] };
  if (method === 'DELETE') return { resource: match[1], action: 'delete', id: match[2] };
  return null;
}

function stageTypes(entries) {
  const entry = entries.find((item) => item.path === '/api/settings/pipeline');
  return new Map((entry?.data?.stages || []).map((stage) => [stage.id, stage.type]));
}

function dealMatches(deal, query, user, types) {
  const search = query.get('q')?.toLowerCase();
  if (search && !deal.title?.toLowerCase().includes(search)) return false;
  if (query.get('stage') && deal.stage !== query.get('stage')) return false;
  if (query.get('owner_id') && user.role !== 'representative' && deal.owner_id !== query.get('owner_id')) return false;
  if (query.get('campaign_id') && deal.campaign_id !== query.get('campaign_id')) return false;
  if (query.get('import_id') && deal.import_id !== query.get('import_id')) return false;
  if (query.get('status')) {
    const type = types.get(deal.stage) || (['won', 'lost'].includes(deal.stage) ? deal.stage : 'open');
    if (query.get('status') === 'closed' ? type === 'open' : type !== 'open') return false;
  }
  return true;
}

function applyMutation(data, responseUrl, mutation, user, types) {
  const target = getMutationTarget(mutation);
  if (!target || !data || typeof data !== 'object') return data;

  const response = new URL(responseUrl, window.location.origin);
  const resource = getResource(response.pathname);
  const responseQuery = response.searchParams;
  if (resource === 'activities' && target.resource === 'deals' && target.action === 'delete' && Array.isArray(data.activities)) {
    data.activities = data.activities.filter((activity) => activity.deal_id !== target.id);
    return data;
  }
  if (resource === 'deals' && target.resource === 'contacts' && target.action === 'delete' && Array.isArray(data.deals)) {
    data.deals = data.deals.map((deal) => (deal.contact_id === target.id ? { ...deal, contact_id: null } : deal));
    return data;
  }
  if (resource !== target.resource) return data;

  const arrayKey = { deals: 'deals', contacts: 'contacts', campaigns: 'campaigns', activities: 'activities' }[resource];
  if (!Array.isArray(data[arrayKey])) return data;
  const rows = data[arrayKey];
  const record = mutation.record;
  const id = target.id;

  if (resource === 'activities' && responseQuery.get('deal_id') !== (target.action === 'create' ? record?.deal_id : mutation.data?.deal_id)) {
    if (target.action !== 'delete') return data;
  }

  const index = rows.findIndex((row) => row.id === id);
  if (target.action === 'delete') {
    if (index !== -1) {
      rows.splice(index, 1);
      if (typeof data.total === 'number') data.total = Math.max(0, data.total - 1);
    }
    return data;
  }

  const next = target.action === 'create' ? record : { ...(rows[index] || {}), ...(record || {}) };
  if (!next?.id) return data;
  if (resource === 'deals' && !dealMatches(next, responseQuery, user, types)) {
    if (index !== -1) {
      rows.splice(index, 1);
      if (typeof data.total === 'number') data.total = Math.max(0, data.total - 1);
    }
    return data;
  }
  if (index === -1) {
    rows.push(next);
    if (typeof data.total === 'number') data.total += 1;
  } else {
    rows[index] = next;
  }
  return data;
}

function deriveDeals(data, url, user, types) {
  const parsed = new URL(url, window.location.origin);
  if (!Array.isArray(data?.deals)) return data;
  let deals = data.deals.filter((deal) => dealMatches(deal, parsed.searchParams, user, types));
  if (parsed.searchParams.get('status') === 'closed') {
    deals = deals.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }
  const total = deals.length;
  const limitValue = parsed.searchParams.get('limit');
  const offsetValue = parsed.searchParams.get('offset');
  if (limitValue !== null || offsetValue !== null) {
    const limit = limitValue === null ? 25 : Number(limitValue);
    const offset = offsetValue === null ? 0 : Number(offsetValue);
    return { ...data, deals: deals.slice(offset, offset + limit), total };
  }
  return { ...data, deals, total };
}

export async function getOfflineResponse(user, url) {
  const entries = await allByUser(RESPONSE_STORE, user.id);
  const queue = await allByUser(MUTATION_STORE, user.id);
  const parsed = new URL(url, window.location.origin);
  const requestUrl = `${parsed.pathname}${parsed.search}`;
  let entry = entries.find((item) => item.url === requestUrl);
  let usedBaseList = false;
  if (!entry && (parsed.pathname === '/api/deals' || parsed.pathname === '/api/deals/priority')) {
    entry = entries.find((item) => item.path === parsed.pathname && !new URL(item.url, window.location.origin).search);
    usedBaseList = Boolean(entry);
  }
  if (!entry && parsed.pathname === '/api/activities') {
    const dealId = parsed.searchParams.get('deal_id');
    const isOfflineDeal = queue.some((mutation) => {
      const target = getMutationTarget(mutation);
      return target?.resource === 'deals' && target.action === 'create' && target.id === dealId;
    });
    if (isOfflineDeal) {
      entry = { url: requestUrl, path: parsed.pathname, data: { activities: [] }, savedAt: Date.now() };
    }
  }
  if (!entry) return null;

  const types = stageTypes(entries);
  let data = clone(entry.data);
  for (const mutation of queue.sort((a, b) => a.createdAt - b.createdAt)) {
    data = applyMutation(data, entry.url, mutation, user, types);
  }
  if (usedBaseList) data = deriveDeals(data, url, user, types);
  return { data, savedAt: entry.savedAt };
}

async function findCachedEntity(userId, resource, id) {
  const entries = await allByUser(RESPONSE_STORE, userId);
  const queue = await allByUser(MUTATION_STORE, userId);
  const key = { deals: 'deals', contacts: 'contacts', campaigns: 'campaigns', activities: 'activities' }[resource];
  let entity = null;
  for (const entry of entries) {
    const rows = entry.data?.[key];
    if (Array.isArray(rows)) {
      const found = rows.find((row) => row.id === id);
      if (found) {
        entity = found;
        break;
      }
    }
  }
  for (const mutation of queue.sort((a, b) => a.createdAt - b.createdAt)) {
    const target = getMutationTarget(mutation);
    if (target?.resource !== resource || target.id !== id) continue;
    if (target.action === 'delete') entity = null;
    else if (target.action === 'create') entity = mutation.record;
    else entity = { ...(entity || {}), ...(mutation.record || {}) };
  }
  return entity;
}

function bodyObject(data) {
  if (typeof data !== 'string') return data || {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function createRecord(resource, body, user, id) {
  const now = new Date().toISOString();
  if (resource === 'deals') {
    if (!body.title || body.value == null || !body.stage) throw new Error('Title, value, and stage are required to save a deal offline.');
    return {
      id,
      company_id: user.company_id,
      title: body.title,
      value: body.value,
      stage: body.stage,
      contact_id: body.contact_id || null,
      campaign_id: body.campaign_id || null,
      expected_close_date: body.expected_close_date || null,
      custom_fields: body.custom_fields || {},
      owner_id: user.id,
      created_at: now,
      updated_at: now,
      closed_at: ['won', 'lost'].includes(body.stage) ? now : null,
      priority_score: 0,
    };
  }
  if (resource === 'contacts') {
    if (!body.name) throw new Error('A name is required to save a contact offline.');
    return {
      id,
      company_id: user.company_id,
      name: body.name,
      company: body.company || null,
      email: body.email || null,
      phone: body.phone || null,
      owner_id: user.id,
      created_at: now,
    };
  }
  if (resource === 'campaigns') {
    if (!body.name) throw new Error('A name is required to save a campaign offline.');
    return {
      id,
      company_id: user.company_id,
      name: body.name,
      budget: body.budget ?? 0,
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      channel: body.channel?.trim() || null,
      created_by: user.id,
      created_at: now,
    };
  }
  if (resource === 'activities') {
    if (!body.deal_id || !['call', 'email', 'meeting', 'note'].includes(body.type)) {
      throw new Error('Choose a deal and activity type before saving offline.');
    }
    return {
      id,
      deal_id: body.deal_id,
      type: body.type,
      notes: body.notes?.trim() || null,
      user_id: user.id,
      created_at: now,
    };
  }
  return null;
}

export async function createQueuedMutation(user, mutation) {
  const target = getMutationTarget(mutation);
  if (!target) throw new Error('This action is not available offline.');
  const body = bodyObject(mutation.data);
  let record = null;
  if (target.action === 'create') {
    record = createRecord(target.resource, body, user, mutation.idempotencyKey);
  } else if (target.action === 'update') {
    const existing = await findCachedEntity(user.id, target.resource, target.id);
    record = { ...(existing || {}), ...body, id: target.id, updated_at: new Date().toISOString() };
    if (target.resource === 'deals' && body.stage && body.stage !== existing?.stage) {
      record.closed_at = ['won', 'lost'].includes(body.stage) ? record.updated_at : null;
    }
  }

  const queued = {
    ...mutation,
    id: crypto.randomUUID(),
    userId: user.id,
    data: body,
    record,
    createdAt: Date.now(),
  };
  await transact(MUTATION_STORE, 'readwrite', (store) => store.put(queued));
  return queued;
}

export const getQueuedMutations = (userId) => allByUser(MUTATION_STORE, userId).then((rows) => rows.sort((a, b) => a.createdAt - b.createdAt));

export const removeQueuedMutation = (id) => transact(MUTATION_STORE, 'readwrite', (store) => store.delete(id));

export async function applyQueuedMutationToCache(user, mutation, serverData) {
  const entries = await allByUser(RESPONSE_STORE, user.id);
  const types = stageTypes(entries);
  const resource = getMutationTarget(mutation)?.resource;
  const responseKey = resource === 'activities' ? 'activity' : resource?.slice(0, -1);
  const record = serverData?.[responseKey] || mutation.record;
  const settledMutation = { ...mutation, record };
  await Promise.all(
    entries.map((entry) => {
      const data = applyMutation(clone(entry.data), entry.url, settledMutation, user, types);
      return transact(RESPONSE_STORE, 'readwrite', (store) =>
        store.put({ ...entry, data, savedAt: Date.now() })
      );
    })
  );
}

export async function getOfflineSummary(userId) {
  const [responses, mutations] = await Promise.all([allByUser(RESPONSE_STORE, userId), allByUser(MUTATION_STORE, userId)]);
  return {
    pendingChanges: mutations.length,
    lastCachedAt: responses.reduce((latest, item) => Math.max(latest, item.savedAt || 0), 0) || null,
  };
}

