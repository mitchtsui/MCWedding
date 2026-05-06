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

module.exports = function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Short edge cache — env vars rarely change, but if they do we want
  // quick recovery.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');

  res.status(200).send(
    'window.SUPABASE_URL=' + JSON.stringify(url) + ';\n' +
    'window.SUPABASE_ANON_KEY=' + JSON.stringify(key) + ';\n'
  );
};
