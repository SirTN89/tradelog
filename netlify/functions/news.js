// Netlify function: /api/news?from=YYYY-MM-DD&to=YYYY-MM-DD
// Fetches ForexFactory XML feeds, merges this+next week, caches per month in Blobs

const { getStore } = require('@netlify/blobs');

const FF_FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.xml',
];

function parseXML(xml) {
  const events = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of items) {
    const get = tag => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title    = get('title');
    const country  = get('country');
    const date     = get('date');     // e.g. "07-23-2026"
    const time     = get('time');     // e.g. "8:30am"
    const impact   = get('impact');   // High, Medium, Low, Holiday
    const actual   = get('actual');
    const forecast = get('forecast');
    const previous = get('previous');

    if (!date || impact === 'Holiday') continue;

    // Convert MM-DD-YYYY → YYYY-MM-DD
    const [mm, dd, yyyy] = date.split('-');
    const isoDate = `${yyyy}-${mm}-${dd}`;

    // Convert "8:30am" → "08:30"
    let isoTime = '';
    const tm = time.match(/(\d+):(\d+)(am|pm)/i);
    if (tm) {
      let h = parseInt(tm[1]);
      const min = tm[2];
      const ampm = tm[3].toLowerCase();
      if (ampm === 'pm' && h !== 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      isoTime = `${String(h).padStart(2,'0')}:${min}`;
    }

    events.push({
      date:     isoDate,
      time:     isoTime,
      event:    title,
      country:  country.toUpperCase(),
      impact:   impact.toLowerCase(),
      actual:   actual || null,
      forecast: forecast || null,
      previous: previous || null,
    });
  }
  return events;
}

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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to' }) };
  }

  const monthKey = `news-ff-${from.slice(0, 7)}`; // e.g. news-ff-2026-07

  try {
    const store = getStore('tradelog');

    // 1. Check Blobs cache
    try {
      const cached = await store.get(monthKey, { type: 'json' });
      if (cached && Array.isArray(cached)) {
        return { statusCode: 200, headers, body: JSON.stringify(cached) };
      }
    } catch(_) {}

    // 2. Fetch both FF feeds
    const allEvents = [];
    for (const url of FF_FEEDS) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tradelog/1.0)' }
        });
        if (res.ok) {
          const xml = await res.text();
          allEvents.push(...parseXML(xml));
        }
      } catch(_) {}
    }

    // Deduplicate by date+event+country
    const seen = new Set();
    const unique = allEvents.filter(e => {
      const k = `${e.date}|${e.event}|${e.country}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // Filter to requested month
    const monthStr = from.slice(0, 7);
    const monthEvents = unique.filter(e => e.date.startsWith(monthStr));

    // 3. Save to Blobs if we got events for this month
    if (monthEvents.length > 0) {
      try { await store.setJSON(monthKey, monthEvents); } catch(_) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify(monthEvents) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
