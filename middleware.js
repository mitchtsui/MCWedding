import { next } from '@vercel/functions';
import hubAuth from './lib/hub-auth.cjs';
import routing from './lib/hub-routing.cjs';

// Node routing middleware runs before public static assets as well as functions.
// Keep the matcher broad so encoded file names cannot skip the access check.
export const config = { runtime: 'nodejs', matcher: '/:path*' };
export default function middleware(request) {
  const url = new URL(request.url);
  if (!routing.isProtectedHubPath(url)) return next();
  let session;
  try { session = hubAuth.verifyHubSession({ headers: { cookie: request.headers.get('cookie') || '' } }); }
  catch { return new Response('Wedding hub is temporarily unavailable', { status:503, headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'} }); }
  if (session.authenticated) return next({ headers: { 'Cache-Control': 'private, no-store' } });
  if (url.pathname.endsWith('.html') || !url.pathname.split('/').pop().includes('.')) {
    // The browser retains its fragment (including a caption invite) across this redirect.
    const login = new URL('/wedding-party-login.html', url.origin);
    login.searchParams.set('return', url.pathname + url.search);
    return new Response(null, { status: 302, headers: { Location: login.href, 'Cache-Control': 'no-store' } });
  }
  return new Response('Wedding party sign-in required', { status: 401, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
}
