import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const store = getStore({ name: 'tradelog', consistency: 'strong' });

    if (req.method === 'GET') {
      const data = await store.get('tradelog-data', { type: 'json' });
      if (data === null) {
        return new Response(JSON.stringify({ error: 'No data yet' }), {
          status: 404,
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    if (req.method === 'PUT') {
      const body = await req.json();
      await store.setJSON('tradelog-data', body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: CORS
      });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });

  } catch (err) {
    console.error('Sync error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/sync' };
