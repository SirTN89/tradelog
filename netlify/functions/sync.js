import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export default async (req, context) => {
  if(req.method === 'OPTIONS') return new Response(null, { status:204, headers:CORS });

  const url   = new URL(req.url);
  const key   = url.searchParams.get('key') || 'meta'; // which blob to operate on

  try {
    const store = getStore({ name: 'tradelog', consistency: 'strong' });

    if(req.method === 'GET'){
      const data = await store.get(key, { type: 'json' });
      if(data === null) return json({ error: 'Not found' }, 404);
      return json(data);
    }

    if(req.method === 'PUT'){
      const body = await req.json();
      await store.setJSON(key, body);
      return json({ ok: true });
    }

    if(req.method === 'DELETE'){
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
