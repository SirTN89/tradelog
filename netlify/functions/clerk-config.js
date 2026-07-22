// Returns the Clerk publishable key to the browser.
// The publishable key is NOT secret — it's safe to expose publicly.
export default async (req) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const key = process.env.CLERK_PUBLISHABLE_KEY || '';
  return new Response(JSON.stringify({ publishableKey: key }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/clerk-config' };
