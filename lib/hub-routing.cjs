'use strict';
const PRIVATE_FILES = new Set([
  '/wedding-party', '/wedding-party.html',
  '/wedding-day', '/wedding-day.html', '/wedding-day.js', '/wedding-day-now.js', '/wedding-day-data.js',
  '/vip-guide', '/vip-guide.html', '/vip-guide.js', '/vip-guide-data.js',
  '/seating-view', '/seating-view.html', '/seating-view.js', '/seating-view.css',
  '/api/seating-view', '/api/seating-view.js'
]);
function isProtectedHubPath(url) {
  let pathname;
  try {
    const decoded = decodeURIComponent(url.pathname);
    if (/%[0-9a-f]{2}/i.test(decoded)) return true;
    const collapsed = decoded.replace(/\\/g, '/').replace(/\/+/g, '/');
    pathname = new URL(collapsed, 'https://hub.invalid').pathname.replace(/\/+$/, '');
  } catch { return true; }
  return PRIVATE_FILES.has(pathname) || pathname === '/photos/vip' || pathname.startsWith('/photos/vip/') ||
    (['/live-captions-admin', '/live-captions-admin.html'].includes(pathname) && url.searchParams.get('hub') === '1');
}
module.exports = { isProtectedHubPath };
