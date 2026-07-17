const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  };

  // Preflight
  if(event.httpMethod === 'OPTIONS'){
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    const store = getStore('tradelog');

    // GET — load data
    if(event.httpMethod === 'GET'){
      const data = await store.get('tradelog-data', { type: 'json' });
      if(data === null){
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'No data yet' }) };
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // PUT — save data
    if(event.httpMethod === 'PUT'){
      const body = JSON.parse(event.body || '{}');
      await store.setJSON('tradelog-data', body);
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true }),
      };
    }

    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  } catch(err) {
    console.error('Sync error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
