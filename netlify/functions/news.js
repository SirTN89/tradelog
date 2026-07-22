// Netlify function: /api/news?from=YYYY-MM-DD&to=YYYY-MM-DD
// Proxies Finnhub economic calendar, caches per month in Blobs

const https = require('https');
const { getStore } = require('@netlify/blobs');

function fetchFinnhub(from, to, key) {
  return new Promise((resolve, reject) => {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const { from, to } = event.queryStringParameters || {};
  if (!from || !to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to params' }) };
  }

  const key = process.env.FINNHUB_KEY;
  if (!key) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'FINNHUB_KEY not set' }) };
  }

  // Cache key: one blob per month e.g. "news-2026-06"
  const cacheKey = `news-${from.slice(0, 7)}`;
  const TTL_MS = 60 * 60 * 1000; // 1 hour

  try {
    const store = getStore('tradelog');

    // Try cache first
    try {
      const cached = await store.getWithMetadata(cacheKey, { type: 'json' });
      if (cached && cached.data && cached.metadata) {
        const age = Date.now() - (cached.metadata.ts || 0);
        if (age < TTL_MS) {
          return { statusCode: 200, headers, body: JSON.stringify(cached.data) };
        }
      }
    } catch(_) {}

    // Fetch from Finnhub
    const data = await fetchFinnhub(from, to, key);
    const events = (data.economicCalendar || []).map(e => ({
      date: e.time ? e.time.slice(0, 10) : '',
      time: e.time ? e.time.slice(11, 16) : '',
      event: e.event || '',
      country: e.country || '',
      impact: e.impact || '',
      actual: e.actual != null ? e.actual : null,
      forecast: e.estimate != null ? e.estimate : null,
      previous: e.prev != null ? e.prev : null,
      unit: e.unit || '',
    })).filter(e => e.date);

    // Save to cache
    try {
      await store.setJSON(cacheKey, events, { metadata: { ts: Date.now() } });
    } catch(_) {}

    return { statusCode: 200, headers, body: JSON.stringify(events) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
