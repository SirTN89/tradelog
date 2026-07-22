// Netlify function: /api/news?from=YYYY-MM-DD&to=YYYY-MM-DD
// Proxies Finnhub economic calendar

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { from, to } = event.queryStringParameters || {};
  if (!from || !to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to params' }) };
  }

  const key = process.env.FINNHUB_KEY;
  if (!key) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'FINNHUB_KEY not configured' }) };
  }

  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: `Finnhub error: ${res.status}` }) };
    }
    const data = await res.json();
    const events = (data.economicCalendar || []).map(e => ({
      date:     (e.time || '').slice(0, 10),
      time:     (e.time || '').slice(11, 16),
      event:    e.event    || '',
      country:  e.country  || '',
      impact:   (e.impact  || '').toLowerCase(),
      actual:   e.actual   != null ? e.actual   : null,
      forecast: e.estimate != null ? e.estimate : null,
      previous: e.prev     != null ? e.prev     : null,
      unit:     e.unit     || '',
    })).filter(e => e.date);

    return { statusCode: 200, headers, body: JSON.stringify(events) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
