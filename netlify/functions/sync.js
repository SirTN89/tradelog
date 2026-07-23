import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function isAuthorized(req) {
  const writeToken = process.env.WRITE_TOKEN;
  if (!writeToken) return false;
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token === writeToken;
}

// ── Key mapping: old flat key → new hierarchical key ─────────────────────────
function newKey(old) {
  if (old === 'tradelog-trades')       return 'core/trades';
  if (old === 'tradelog-eods')         return 'core/eods';
  if (old === 'tradelog-playbook')     return 'core/playbook';
  if (old === 'tradelog-settings')     return 'core/settings';
  if (old === 'tradelog-templates')    return 'core/templates';
  if (old === 'tradelog-auth-probe')   return 'core/auth-probe';
  if (old.startsWith('tradelog-ss-eod-'))   return `screenshots/eod/${old.slice('tradelog-ss-eod-'.length)}`;
  if (old.startsWith('tradelog-ss-trade-')) return `screenshots/trades/${old.slice('tradelog-ss-trade-'.length)}`;
  if (old.startsWith('tradelog-ss-play-'))  return `screenshots/playbook/${old.slice('tradelog-ss-play-'.length)}`;
  if (old.startsWith('tradelog-csv-'))      return `csv/${old.slice('tradelog-csv-'.length)}`;
  if (old.startsWith('news-ff-'))           return `news/${old}`;
  return null; // unknown — skip
}

// List of known old flat prefixes to scan
const OLD_PREFIXES = [
  'tradelog-trades', 'tradelog-eods', 'tradelog-playbook',
  'tradelog-settings', 'tradelog-templates', 'tradelog-auth-probe',
  'tradelog-ss-', 'tradelog-csv-', 'news-ff-',
];

async function listOldKeys(store) {
  const keys = new Set();
  // List all keys in the store (no prefix = everything)
  const result = await store.list();
  for (const blob of (result.blobs || [])) {
    const k = blob.key;
    const isOld = OLD_PREFIXES.some(p => k === p || k.startsWith(p));
    if (isOld) keys.add(k);
  }
  return [...keys];
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const key = url.searchParams.get('key') || 'meta';
  const action = url.searchParams.get('action');

  const store = getStore({ name: 'tradelog', consistency: 'strong' });

  // ── Migration endpoints ───────────────────────────────────────────────────
  if (action === 'migrate-copy' || action === 'migrate-delete') {
    if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401);

    try {
      const oldKeys = await listOldKeys(store);
      const results = [];

      for (const old of oldKeys) {
        const nk = newKey(old);
        if (!nk) { results.push({ old, status: 'skipped' }); continue; }

        if (action === 'migrate-copy') {
          try {
            // Read raw text to preserve exact bytes regardless of content type
            const raw = await store.get(old, { type: 'text' });
            if (raw === null) { results.push({ old, nk, status: 'missing' }); continue; }
            await store.set(nk, raw, { metadata: { migratedFrom: old, migratedAt: Date.now() } });
            results.push({ old, nk, status: 'copied' });
          } catch(e) {
            results.push({ old, nk, status: 'error', msg: e.message });
          }
        }

        if (action === 'migrate-delete') {
          try {
            // Only delete if new key exists
            const check = await store.get(nk, { type: 'text' });
            if (check === null) { results.push({ old, nk, status: 'skipped-missing-new' }); continue; }
            await store.delete(old);
            results.push({ old, nk, status: 'deleted' });
          } catch(e) {
            results.push({ old, nk, status: 'error', msg: e.message });
          }
        }
      }

      // After successful copy, update app keys too
      if (action === 'migrate-copy') {
        const copied = results.filter(r => r.status === 'copied').length;
        if (copied > 0) {
          await store.set('core/migrated-v2', JSON.stringify({ ts: Date.now(), total: copied }));
        }
      }

      return json({ action, total: oldKeys.length, results });
    } catch(err) {
      return json({ error: err.message }, 500);
    }
  }

  // ── Standard GET/PUT/DELETE ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const data = await store.get(key, { type: 'json' });
      if (data === null) return json({ error: 'Not found' }, 404);
      return json(data);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  if (req.method === 'PUT' || req.method === 'DELETE') {
    if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401);
    try {
      if (req.method === 'PUT') {
        const body = await req.json();
        await store.setJSON(key, body);
        return json({ ok: true });
      }
      if (req.method === 'DELETE') {
        await store.delete(key);
        return json({ ok: true });
      }
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
};

export const config = { path: '/api/sync' };
