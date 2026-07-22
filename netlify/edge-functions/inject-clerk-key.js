// Netlify Edge Function — runs on every request for index.html
// Injects the Clerk publishable key as a <meta> tag so the browser can load
// Clerk's SDK without embedding the key in the static HTML file.

export default async (request, context) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only transform HTML responses
  if (!contentType.includes('text/html')) return response;

  const key = Deno.env.get('CLERK_PUBLISHABLE_KEY') || 'MISSING';
  const metaTag = `<meta name="clerk-publishable-key" content="${key}">`;

  // Use HTMLRewriter to inject the meta tag into <head>
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(metaTag, { html: true });
      }
    })
    .transform(response);
};

export const config = { path: '/' };
