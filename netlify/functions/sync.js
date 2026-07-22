import { getStore } from '@netlify/blobs';
import { createClerkClient } from '@clerk/backend';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Verify the Clerk JWT from the Authorization header.
// Returns the userId if valid, null otherwise.
async function verifyClerkToken(req) {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();

    const clerk = createClerkClient({ secretKey });
    const { payload } = await clerk.verifyToken(token);
    return payload?.sub || null; // sub = Clerk userId
  } catch (e) {
    console.warn('Token verification failed:', e.message);
    return null;
  }
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const key = url.searchParams.get('key') || 'meta';

  // ── GET — always public (read-only visitors) ────────────────────────────────
  if (req.method === 'GET') {
    try {
      const store = getStore({ name: 'tradelog', consistency: 'strong' });
      const data = await store.get(key, { type: 'json' });
      if (data === null) return json({ error: 'Not found' }, 404);
      return json(data);
    } catch (err) {
      console.error('GET error:', err);
      return json({ error: err.message }, 500);
    }
  }

  // ── PUT / DELETE — require valid Clerk JWT ──────────────────────────────────
  if (req.method === 'PUT' || req.method === 'DELETE') {
    const userId = await verifyClerkToken(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    try {
      const store = getStore({ name: 'tradelog', consistency: 'strong' });

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
      console.error('Write error:', err);
      return json({ error: err.message }, 500);
    }
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
};

export const config = { path: '/api/sync' };
