'use strict';

const { HubAuthError, createHubAuth, assertSameOrigin } = require('../lib/hub-auth.cjs');
const { clearOperatorCookie } = require('../lib/captions/operator-auth.cjs');

const MAX_BODY_BYTES = 4096;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  const declared = Number(req.headers?.['content-length'] || 0);
  if (declared > MAX_BODY_BYTES) throw new HubAuthError('PAYLOAD_TOO_LARGE', 'Request is too large', 413);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    let encoded;
    try { encoded = JSON.stringify(req.body); } catch { throw new HubAuthError('INVALID_JSON', 'Request body must be valid JSON', 400); }
    if (Buffer.byteLength(encoded) > MAX_BODY_BYTES) throw new HubAuthError('PAYLOAD_TOO_LARGE', 'Request is too large', 413);
    return req.body;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HubAuthError('PAYLOAD_TOO_LARGE', 'Request is too large', 413);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HubAuthError('INVALID_JSON', 'Request body must be valid JSON', 400); }
}

function createHandler({ env = process.env, now = Date.now } = {}) {
  const auth = createHubAuth({ env, now });
  return async function hubSessionHandler(req, res) {
    try {
      if (req.method === 'GET') {
        auth.ready();
        const session = auth.inspect(req);
        if (session.present && !session.authenticated) res.setHeader('Set-Cookie', auth.clearCookie());
        sendJson(res, 200, { ok: true, data: { authenticated: session.authenticated, expiresAt: session.expiresAt } });
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new HubAuthError('METHOD_NOT_ALLOWED', 'Method is not allowed', 405);
      }
      assertSameOrigin(req);
      const input = parseBody(req);
      if (input.action === 'logout') {
        res.setHeader('Set-Cookie', [auth.clearCookie(), clearOperatorCookie()]);
        sendJson(res, 200, { ok: true, data: { authenticated: false, expiresAt: null } });
        return;
      }
      if (input.action !== 'login') throw new HubAuthError('INVALID_REQUEST', 'Action is invalid', 400);
      const login = auth.login(req, input.password);
      res.setHeader('Set-Cookie', login.cookie);
      sendJson(res, 200, { ok: true, data: { authenticated: true, expiresAt: login.expiresAt } });
    } catch (error) {
      const known = error instanceof HubAuthError;
      sendJson(res, known ? error.status : 500, { ok: false,
        error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Wedding hub encountered an error' } });
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
