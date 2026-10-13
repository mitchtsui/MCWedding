'use strict';

const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { CaptionStoreError } = require('./store.cjs');

const COOKIE_NAME = '__Host-mcw-caption-operator';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
// The caption SQL deliberately uses this identity when a service-role RPC has no auth.uid().
// Its publisher/ticket columns are UUIDs without an auth.users foreign key.
const OPERATOR_ID = '00000000-0000-0000-0000-000000000000';
const SCOPE = 'captions:operate';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function configuration(env) {
  const password = String(env.CAPTIONS_OPERATOR_PASSWORD || '');
  const secret = String(env.CAPTIONS_OPERATOR_SESSION_SECRET || '');
  if (password.length < 6 || password.length > 1024 || secret.length < 32 || secret.length > 4096 || password === secret) {
    throw new CaptionStoreError('OPERATOR_AUTH_UNAVAILABLE', 'Caption operator authentication is unavailable', 503);
  }
  // Binding sessions to both values means rotating either one invalidates every existing cookie.
  return { password, sessionKey: createHmac('sha256', secret).update(password).digest() };
}

function parseCookies(req) {
  const result = new Map();
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (!result.has(name)) result.set(name, part.slice(at + 1).trim());
  }
  return result;
}

function requestIp(req) {
  return String(req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for']
    || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 200);
}

function assertSameOrigin(req) {
  const origin = String(req.headers?.origin || '');
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  const protocol = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  let parsed;
  try { parsed = new URL(origin); } catch { parsed = null; }
  const expectedProtocol = protocol || parsed?.protocol?.replace(':', '') || '';
  if (!parsed || !host || !expectedProtocol || parsed.origin !== `${expectedProtocol}://${host}`) {
    throw new CaptionStoreError('ORIGIN_FORBIDDEN', 'Request origin is not allowed', 403);
  }
}

function cookie(value, expiresAt) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function createOperatorAuth({ env = process.env, now = Date.now } = {}) {
  const failures = new Map();

  function prune(at) {
    for (const [key, value] of failures) if (value.resetAt <= at) failures.delete(key);
    while (failures.size > 2000) failures.delete(failures.keys().next().value);
  }

  function sign(payload, secret) {
    const encoded = base64url(JSON.stringify(payload));
    const signature = createHmac('sha256', secret).update(`v1.${encoded}`).digest('base64url');
    return `v1.${encoded}.${signature}`;
  }

  function inspect(req) {
    const token = parseCookies(req).get(COOKIE_NAME);
    if (!token) return { authenticated: false, expiresAt: null, present: false };
    let sessionKey;
    try { sessionKey = configuration(env).sessionKey; } catch { return { authenticated: false, expiresAt: null, present: true }; }
    if (token.length > 4096) return { authenticated: false, expiresAt: null, present: true };
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return { authenticated: false, expiresAt: null, present: true };
    const expected = createHmac('sha256', sessionKey).update(`v1.${parts[1]}`).digest('base64url');
    if (!safeEqual(parts[2], expected)) return { authenticated: false, expiresAt: null, present: true };
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { authenticated: false, expiresAt: null, present: true }; }
    const at = now();
    if (payload?.v !== 1 || payload.sub !== OPERATOR_ID || payload.scope !== SCOPE
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.iat > at + 60_000 || payload.exp <= at || payload.exp - payload.iat !== SESSION_TTL_MS) {
      return { authenticated: false, expiresAt: null, present: true };
    }
    return { authenticated: true, expiresAt: new Date(payload.exp).toISOString(), present: true, id: OPERATOR_ID,
      scope: SCOPE, snapshotRateIdentity: `caption-session:${payload.nonce}` };
  }

  function login(req, password) {
    const { password: expected, sessionKey } = configuration(env);
    const at = now(), ip = requestIp(req);
    prune(at);
    const bucket = failures.get(ip);
    if (bucket && bucket.resetAt > at && bucket.count >= LOGIN_FAILURE_LIMIT) {
      throw new CaptionStoreError('RATE_LIMITED', 'Too many login attempts', 429);
    }
    const supplied = typeof password === 'string' && password.length <= 1024 ? password : '';
    const valid = safeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest());
    if (!valid) {
      failures.set(ip, { count: (bucket?.count || 0) + 1, resetAt: bucket?.resetAt > at ? bucket.resetAt : at + LOGIN_WINDOW_MS });
      throw new CaptionStoreError('INVALID_CREDENTIALS', 'Caption operator password is incorrect', 401);
    }
    failures.delete(ip);
    const expiresAt = at + SESSION_TTL_MS;
    const token = sign({ v: 1, sub: OPERATOR_ID, scope: SCOPE, iat: at, exp: expiresAt,
      nonce: randomBytes(16).toString('base64url') }, sessionKey);
    return { authenticated: true, expiresAt: new Date(expiresAt).toISOString(), cookie: cookie(token, expiresAt) };
  }

  return Object.freeze({
    inspect,
    login,
    ready() { configuration(env); return true; },
    clearCookie: expiredCookie,
  });
}

module.exports = { COOKIE_NAME, SESSION_TTL_MS, LOGIN_WINDOW_MS, LOGIN_FAILURE_LIMIT, OPERATOR_ID, SCOPE,
  configuration, assertSameOrigin, createOperatorAuth, clearOperatorCookie: expiredCookie };
