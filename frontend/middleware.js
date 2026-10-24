import { NextResponse } from 'next/server';
import { buildLegacyEventRedirectPath } from './lib/legacyEventPathRedirects.js';

// The event used to live under /blockchain-masterclass. Every printed ticket,
// QR code and referral campaign may still point there, so the old address is
// permanently redirected to the same page on the bare domain. The redirect is
// built from the request URL so query parameters (for example ?utm_source=)
// survive the hop; a static redirect rule loses them on the root path.
function redirectLegacyEventPathToRoot(request) {
  const legacyEventRedirectPath = buildLegacyEventRedirectPath(request.nextUrl.pathname);

  if (!legacyEventRedirectPath) {
    return null;
  }

  const legacyEventRedirectUrl = request.nextUrl.clone();
  legacyEventRedirectUrl.pathname = legacyEventRedirectPath;
  return NextResponse.redirect(legacyEventRedirectUrl, 308);
}

// API requests are served in-process by the route-group handlers under
// pages/api/, with the catch-all as a fallback. The browser still sends an
// Origin header on same-origin POSTs, and the API's CORS allowlist only lists
// known origins (every Vercel preview URL would otherwise have to be added).
// The browser never leaves this origin, so the header carries no meaning for
// the internal hop and is removed here. A direct cross-origin call from
// another site does not pass through this middleware and is still checked.
export function middleware(request) {
  const legacyEventRedirectResponse = redirectLegacyEventPathToRoot(request);
  if (legacyEventRedirectResponse) {
    return legacyEventRedirectResponse;
  }

  const proxiedRequestHeaders = new Headers(request.headers);
  proxiedRequestHeaders.delete('origin');

  return NextResponse.next({
    request: { headers: proxiedRequestHeaders },
  });
}

export const config = {
  // The legacy prefix is written out literally because Next statically analyses
  // this matcher at build time. Keep it in sync with PRIMARY_EVENT_SLUG in
  // shared/eventConfig.js when the slug ever changes.
  matcher: [
    '/api/:path*',
    '/blockchain-masterclass',
    '/blockchain-masterclass/:path*',
  ],
};
