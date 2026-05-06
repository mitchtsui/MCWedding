// Vercel serverless function — exposes Supabase credentials to the
// browser via window globals. Reads from Vercel environment variables
// (set in Project Settings → Environment Variables).
//
// Required env vars:
//   SUPABASE_URL       — e.g. https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY  — the public anon JWT
//
// The anon key is designed to be exposed to browsers; security comes
// from RLS, not key secrecy.

// Tolerates common mis-pastes: strips trailing slashes and any
// /rest/v1, /auth/v1, /storage/v1, /realtime/v1, /functions/v1
// path that the user may have accidentally copied from the Supabase
// dashboard. The JS SDK expects only the project origin.
function sanitiseUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  u = u.replace(/\/+(rest|auth|storage|realtime|functions)\/v[0-9]+(\/.*)?$/i, '');
  u = u.replace(/\/+$/, '');
  return u;
}

module.exports = function handler(req, res) {
  const url = sanitiseUrl(process.env.SUPABASE_URL);
  const key = (process.env.SUPABASE_ANON_KEY || '').trim();

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Short edge cache — env vars rarely change, but if they do we want
  // quick recovery.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');

  res.status(200).send(
    'window.SUPABASE_URL=' + JSON.stringify(url) + ';\n' +
    'window.SUPABASE_ANON_KEY=' + JSON.stringify(key) + ';\n'
  );
};
