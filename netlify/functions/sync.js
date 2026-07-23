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

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const key = url.searchParams.get('key') || 'meta';

  const store = getStore({ name: 'tradelog', consistency: 'strong' });

  // GET — always public
  if (req.method === 'GET') {
    try {
      const data = await store.get(key, { type: 'json' });
      if (data === null) return json({ error: 'Not found' }, 404);
      return json(data);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  // PUT / DELETE — require WRITE_TOKEN
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
