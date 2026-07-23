import { getStore } from '@netlify/blobs';

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
    const date     = get('date');
    const time     = get('time');
    const impact   = get('impact');
    const actual   = get('actual');
    const forecast = get('forecast');
    const previous = get('previous');

    if (!date || impact === 'Holiday') continue;

    // FF format: MM-DD-YYYY
    const parts = date.split('-');
    let isoDate = date;
    if (parts.length === 3 && parts[2].length === 4) {
      isoDate = `${parts[2]}-${parts[0]}-${parts[1]}`;
    }

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
      date: isoDate, time: isoTime, event: title,
      country: country.toUpperCase(), impact: impact.toLowerCase(),
      actual: actual || null, forecast: forecast || null, previous: previous || null,
    });
  }
  return events;
}

export default async (request, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to   = url.searchParams.get('to');
  const debug = url.searchParams.get('debug') === '1';

  if (!from || !to) {
    return new Response(JSON.stringify({ error: 'Missing from/to' }), { status: 400, headers });
  }

  const monthKey = `news-ff-${from.slice(0, 7)}`;

  try {
    const store = getStore('tradelog');

    // 1. Check Blobs cache (skip if debug)
    if (!debug) {
      try {
        const cached = await store.get(monthKey, { type: 'json' });
        if (cached && Array.isArray(cached)) {
          return new Response(JSON.stringify(cached), { status: 200, headers });
        }
      } catch(_) {}
    }

    // 2. Fetch both FF feeds
    const allEvents = [];
    const debugInfo = [];

    for (const feedUrl of FF_FEEDS) {
      try {
        const res = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tradelog/1.0)' }
        });
        const xml = await res.text();
        const parsed = parseXML(xml);
        if (debug) {
          debugInfo.push({
            feed: feedUrl,
            status: res.status,
            itemCount: (xml.match(/<item>/g) || []).length,
            parsedCount: parsed.length,
            sample: parsed.slice(0, 3),
            rawSample: xml.slice(0, 500),
          });
        }
        allEvents.push(...parsed);
      } catch(e) {
        if (debug) debugInfo.push({ feed: feedUrl, error: e.message });
      }
    }

    if (debug) {
      return new Response(JSON.stringify({ debugInfo, allEvents: allEvents.slice(0, 10) }, null, 2), { status: 200, headers });
    }

    // Deduplicate
    const seen = new Set();
    const unique = allEvents.filter(e => {
      const k = `${e.date}|${e.event}|${e.country}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    const monthStr = from.slice(0, 7);
    const monthEvents = unique.filter(e => e.date.startsWith(monthStr));

    if (monthEvents.length > 0) {
      try { await store.setJSON(monthKey, monthEvents); } catch(_) {}
    }

    return new Response(JSON.stringify(monthEvents), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/news' };
