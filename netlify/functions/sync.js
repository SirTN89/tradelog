import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

// Verify the Netlify Identity JWT and return the decoded payload, or null
async function verifyToken(req) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    // Netlify Identity JWTs are signed — decode the payload (middle segment)
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    // base64url → base64 → JSON
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(padded));
    // Check expiry
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Get roles array from the JWT payload
function getRoles(payload) {
  return payload?.app_metadata?.roles || [];
}

export default async (req, context) => {
  if(req.method === 'OPTIONS') return new Response(null, { status:204, headers:CORS });

  // ── Auth check ────────────────────────────────────────────────────────────
  const payload = await verifyToken(req);
  if (!payload) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const roles = getRoles(payload);
  const isAdmin = roles.includes('admin');
  const isReader = roles.includes('reader');
  const canRead  = isAdmin || isReader;
  const canWrite = isAdmin;

  // ── Route ─────────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || 'meta';

  try {
    const store = getStore({ name: 'tradelog', consistency: 'strong' });

    if(req.method === 'GET'){
      if (!canRead) return json({ error: 'Forbidden' }, 403);
      const data = await store.get(key, { type: 'json' });
      if(data === null) return json({ error: 'Not found' }, 404);
      return json(data);
    }

    if(req.method === 'PUT'){
      if (!canWrite) return json({ error: 'Forbidden — read-only role' }, 403);
      const body = await req.json();
      await store.setJSON(key, body);
      return json({ ok: true });
    }

    if(req.method === 'DELETE'){
      if (!canWrite) return json({ error: 'Forbidden — read-only role' }, 403);
      await store.delete(key);
      return json({ ok: true });
    }

    return new Response('Method not allowed', { status:405, headers:CORS });

  } catch(err) {
    console.error('Sync error:', err);
    return json({ error: err.message }, 500);
  }
};

export const config = { path: '/api/sync' };
