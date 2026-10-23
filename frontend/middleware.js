import { NextResponse } from 'next/server';

// Every /api/* call is served in-process by pages/api/[...all].js, which hands
// the request to the Express application. The browser still sends an Origin
// header on same-origin POSTs, and the API's CORS allowlist only lists known
// origins (every Vercel preview URL would otherwise have to be added). The
// browser never leaves this origin, so the header carries no meaning for the
// internal hop and is removed here. A direct cross-origin call from another
// site does not pass through this middleware and is still checked by the API.
export function middleware(request) {
  const proxiedRequestHeaders = new Headers(request.headers);
  proxiedRequestHeaders.delete('origin');

  return NextResponse.next({
    request: { headers: proxiedRequestHeaders },
  });
}

export const config = {
  matcher: '/api/:path*',
};
