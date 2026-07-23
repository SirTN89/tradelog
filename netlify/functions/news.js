import { getStore } from '@netlify/blobs';

const FF_FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
];

const CURRENCY_TO_COUNTRY = {
  'USD': 'US', 'EUR': 'EU', 'GBP': 'GB', 'JPY': 'JP',
  'CAD': 'CA', 'AUD': 'AU', 'CHF': 'CH', 'CNY': 'CN', 'NZD': 'NZ',
};

// Cache TTL: 4 hours for current week, permanent for past weeks
const CURRENT_WEEK_TTL_MS = 4 * 60 * 60 * 1000;

function parseXML(xml) {
  const events = [];
  const items = xml.match(/<event>([\s\S]*?)<\/event>/g) || [];
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

    if (!date || impact === 'Holiday' || title === 'Bank Holiday') continue;

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

    const rawCountry = country.toUpperCase();
    events.push({
      date: isoDate, time: isoTime, event: title,
      country: CURRENCY_TO_COUNTRY[rawCountry] || rawCountry,
      impact: impact.toLowerCase(),
      actual: actual || null, forecast: forecast || null, previous: previous || null,
    });
  }
  return events;
}

function isCurrentWeek(monthStr) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return monthStr === currentMonth;
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
  const from  = url.searchParams.get('from');
  const to    = url.searchParams.get('to');
  const debug = url.searchParams.get('debug') === '1';

  if (!from || !to) {
    return new Response(JSON.stringify({ error: 'Missing from/to' }), { status: 400, headers });
  }

  const monthStr = from.slice(0, 7);
  const monthKey = `news/ff-${monthStr}`;
  const isCurrent = isCurrentWeek(monthStr);

  try {
    const store = getStore('tradelog');

    // Check cache — always use for past months, check TTL for current month
    if (!debug) {
      try {
        const cached = await store.getWithMetadata(monthKey, { type: 'json' });
        if (cached && cached.data && Array.isArray(cached.data)) {
          const age = Date.now() - (cached.metadata?.ts || 0);
          if (!isCurrent || age < CURRENT_WEEK_TTL_MS) {
            return new Response(JSON.stringify(cached.data), { status: 200, headers });
          }
          // Current month cache stale — fall through to re-fetch
        }
      } catch(_) {}
    }

    // Fetch from FF
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
            feed: feedUrl, status: res.status,
            itemCount: (xml.match(/<event>/g) || []).length,
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

    // Filter to requested month
    const monthEvents = unique.filter(e => e.date.startsWith(monthStr));

    // Cache with timestamp
    if (monthEvents.length > 0) {
      try {
        await store.set(monthKey, JSON.stringify(monthEvents), {
          metadata: { ts: Date.now() }
        });
      } catch(_) {}
    }

    return new Response(JSON.stringify(monthEvents), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/news' };
