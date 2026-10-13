'use strict';

const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const COOKIE_NAME = '__Host-mcw-wedding-hub';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const SCOPE = 'wedding-hub:view';

class HubAuthError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'HubAuthError';
    this.code = code;
    this.status = status;
  }
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function configuration(env) {
  const password = String(env.WEDDING_HUB_PASSWORD || '');
  const secret = String(env.WEDDING_HUB_SESSION_SECRET || '');
  if (password.length < 4 || password.length > 1024 || secret.length < 32 || secret.length > 4096 || password === secret) {
    throw new HubAuthError('HUB_AUTH_UNAVAILABLE', 'Wedding hub authentication is unavailable', 503);
  }
  return { password, sessionKey: createHmac('sha256', secret).update(password).digest() };
}

function headerValue(req, name) {
  const headers = req.headers;
  if (headers && typeof headers.get === 'function') return headers.get(name) || '';
  return String(headers?.[name] || headers?.[name.toLowerCase()] || '');
}

function cookieValue(req) {
  for (const part of headerValue(req, 'cookie').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE_NAME) return part.slice(at + 1).trim();
  }
  return '';
}

function requestIp(req) {
  return String(headerValue(req, 'x-vercel-forwarded-for') || headerValue(req, 'x-forwarded-for')
    || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 200);
}

function assertSameOrigin(req) {
  const origin = headerValue(req, 'origin');
  const host = String(headerValue(req, 'x-forwarded-host') || headerValue(req, 'host')).split(',')[0].trim();
  const protocol = headerValue(req, 'x-forwarded-proto').split(',')[0].trim();
  let parsed;
  try { parsed = new URL(origin); } catch { parsed = null; }
  const expectedProtocol = protocol || parsed?.protocol?.replace(':', '') || '';
  if (!parsed || !host || !expectedProtocol || parsed.origin !== `${expectedProtocol}://${host}`) {
    throw new HubAuthError('ORIGIN_FORBIDDEN', 'Request origin is not allowed', 403);
  }
}

function sessionCookie(value, expiresAt) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function createHubAuth({ env = process.env, now = Date.now } = {}) {
  const failures = new Map();

  function inspect(req) {
    const token = cookieValue(req);
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
    if (payload?.v !== 1 || payload.scope !== SCOPE || typeof payload.nonce !== 'string' || payload.nonce.length < 16
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.iat > at + 60_000 || payload.exp <= at || payload.exp - payload.iat !== SESSION_TTL_MS) {
      return { authenticated: false, expiresAt: null, present: true };
    }
    return { authenticated: true, expiresAt: new Date(payload.exp).toISOString(), present: true,
      scope: SCOPE, sessionId: payload.nonce };
  }

  function login(req, password) {
    const { password: expected, sessionKey } = configuration(env);
    const at = now(), ip = requestIp(req);
    for (const [key, value] of failures) if (value.resetAt <= at) failures.delete(key);
    while (failures.size > 2000) failures.delete(failures.keys().next().value);
    const bucket = failures.get(ip);
    if (bucket && bucket.resetAt > at && bucket.count >= LOGIN_FAILURE_LIMIT) {
      throw new HubAuthError('RATE_LIMITED', 'Too many login attempts', 429);
    }
    const supplied = typeof password === 'string' && password.length <= 1024 ? password : '';
    const valid = safeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest());
    if (!valid) {
      failures.set(ip, { count: (bucket?.count || 0) + 1, resetAt: bucket?.resetAt > at ? bucket.resetAt : at + LOGIN_WINDOW_MS });
      throw new HubAuthError('INVALID_CREDENTIALS', 'Wedding hub password is incorrect', 401);
    }
    failures.delete(ip);
    const expiresAt = at + SESSION_TTL_MS;
    const payload = { v: 1, scope: SCOPE, iat: at, exp: expiresAt, nonce: randomBytes(16).toString('base64url') };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', sessionKey).update(`v1.${encoded}`).digest('base64url');
    return { authenticated: true, expiresAt: new Date(expiresAt).toISOString(),
      cookie: sessionCookie(`v1.${encoded}.${signature}`, expiresAt) };
  }

  return Object.freeze({ inspect, login, ready() { configuration(env); return true; }, clearCookie: expiredCookie });
}

function verifyHubSession(req, { env = process.env, now = Date.now } = {}) {
  const auth = createHubAuth({ env, now });
  auth.ready();
  return auth.inspect(req);
}

module.exports = { COOKIE_NAME, SESSION_TTL_MS, LOGIN_WINDOW_MS, LOGIN_FAILURE_LIMIT, SCOPE, HubAuthError,
  configuration, assertSameOrigin, createHubAuth, verifyHubSession };
