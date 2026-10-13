'use strict';
const { verifyHubSession } = require('../lib/hub-auth.cjs');

const MAX_ROWS = 500;

function sanitiseUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  value = value.replace(/\/+((rest|auth|storage|realtime|functions)\/v[0-9]+)(\/.*)?$/i, '');
  return value.replace(/\/+$/, '');
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

function normaliseRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Unexpected seating response');
  if (rows.length > MAX_ROWS) throw new Error('Seating response exceeds its supported size');
  return rows
    .filter(row => row && Number.isInteger(row.guest_number) && typeof row.name === 'string' &&
      row.name.trim() && !row.name.includes('[PREVIEW]') && Number.isInteger(row.table_number))
    .sort((a, b) => a.guest_number - b.guest_number)
    .map(row => ({ name: row.name.trim(), table_number: row.table_number }));
}

function createHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function seatingViewHandler(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET' });
      return;
    }

    let hubSession;
    try { hubSession = verifyHubSession(req, { env }); }
    catch { sendJson(res,503,{ok:false,error:'Wedding hub is unavailable'});return; }
    if (!hubSession.authenticated) {
      sendJson(res, 401, { ok: false, error: 'Wedding party sign-in required' });
      return;
    }

    const supabaseUrl = sanitiseUrl(env.SUPABASE_URL);
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !serviceRoleKey || typeof fetchImpl !== 'function') {
      sendJson(res, 503, { ok: false, error: 'Seating view is unavailable' });
      return;
    }

    // guest_number is requested only to exclude the unnumbered Admin Preview
    // rows and retain the roster's stable ordering. It is removed before the
    // response reaches the browser. No RSVP, contact or seat-level fields are
    // read by this endpoint.
    const query = new URLSearchParams({
      select: 'guest_number,name,table_number',
      guest_number: 'not.is.null',
      table_number: 'not.is.null',
      order: 'guest_number.asc',
      limit: String(MAX_ROWS + 1)
    });

    try {
      const upstream = await fetchImpl(`${supabaseUrl}/rest/v1/guests?${query}`, {
        method: 'GET',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json'
        }
      });
      if (!upstream.ok) throw new Error(`Supabase returned ${upstream.status}`);
      const guests = normaliseRows(await upstream.json());
      sendJson(res, 200, { ok: true, guests });
    } catch (error) {
      console.error('[seating-view] read failed', error instanceof Error ? error.message : 'unknown error');
      sendJson(res, 502, { ok: false, error: 'Unable to load the seating plan' });
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.normaliseRows = normaliseRows;
module.exports.sanitiseUrl = sanitiseUrl;
