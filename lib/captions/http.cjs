'use strict';

const { randomUUID } = require('node:crypto');
const { CaptionStoreError } = require('./store.cjs');

const MAX_BODY_BYTES = 64 * 1024;
const buckets = new Map();

function requestId(req) {
  const supplied = String(req.headers?.['x-request-id'] || '');
  return /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

function bearerToken(req) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(req.headers?.authorization || ''));
  if (!match) throw new CaptionStoreError('UNAUTHENTICATED', 'Authentication is required', 401);
  return match[1];
}

function allowedOrigins(env = process.env) {
  return new Set(String(env.CAPTIONS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
}

function assertOrigin(req, env = process.env) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = String(req.headers?.origin || '');
  const allowed = allowedOrigins(env);
  if (!origin || !allowed.has(origin)) throw new CaptionStoreError('ORIGIN_FORBIDDEN', 'Request origin is not allowed', 403);
}

function parseBody(req) {
  const declared = Number(req.headers?.['content-length'] || 0);
  if (declared > MAX_BODY_BYTES) throw new CaptionStoreError('PAYLOAD_TOO_LARGE', 'Request is too large', 413);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    let encoded;
    try { encoded = JSON.stringify(req.body); } catch { throw new CaptionStoreError('INVALID_JSON', 'Request body must be valid JSON', 400); }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_BODY_BYTES) throw new CaptionStoreError('PAYLOAD_TOO_LARGE', 'Request is too large', 413);
    return req.body;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new CaptionStoreError('PAYLOAD_TOO_LARGE', 'Request is too large', 413);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new CaptionStoreError('INVALID_JSON', 'Request body must be valid JSON', 400); }
}

function hitBucket(key, limit, windowMs, now) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > limit) throw new CaptionStoreError('RATE_LIMITED', 'Too many requests', 429);
  return { limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

function clientIp(req) {
  return String(req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// At most once a second: guest device ids can create thousands of buckets a minute, and a full scan per request would be the cost.
let prunedAt = 0;
function pruneBuckets(now) {
  if (buckets.size > 5000 && Math.abs(now - prunedAt) >= 1000) {
    prunedAt = now;
    for (const [candidate, value] of buckets) if (value.resetAt <= now) buckets.delete(candidate);
  }
}

// Buckets live in this instance's memory: each serverless instance counts on its own.
function rateLimit(req, action, identity = null, now = Date.now()) {
  const ip = clientIp(req);
  const windowMs = 60_000;
  // config is static and touches no database; a venue of phones scanning the QR code together shares one IP.
  const userLimit = action === 'config' ? 20000 : action === 'snapshot' ? 120 : 90;
  const aggregate = hitBucket(`ip:${ip}:${action}`, identity ? 600 : userLimit, windowMs, now);
  const result = identity ? hitBucket(`user:${identity}:${action}`, userLimit, windowMs, now) : aggregate;
  pruneBuckets(now);
  return result;
}

// Guests have no account and a whole hotel can share one IP, so nothing honest phones spend is capped per IP:
// each device (its own random id, or the IP when it sends none) is held to a phone's polling rate, and the IP
// has only a budget of failed requests below.
function guestRateLimit(req, deviceId, now = Date.now()) {
  const ip = clientIp(req);
  const device = typeof deviceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(deviceId) ? deviceId : ip;
  const result = hitBucket(`guest-device:${device}`, 60, 60_000, now);
  pruneBuckets(now);
  return result;
}

// Failed guest requests per IP per minute: bad input, a link that is not valid, a run that is not the event's.
// A slot is taken before the database is asked and given back if the request succeeds or the server fails, so a
// client spraying guessed links, even in parallel, is refused once the budget is spent and costs no more calls.
const GUEST_FAILURES_PER_MINUTE = 600;

function takeGuestFailureSlot(req, now = Date.now()) {
  const key = `guest-fail-ip:${clientIp(req)}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + 60_000 };
  if (bucket.count >= GUEST_FAILURES_PER_MINUTE) return false;
  bucket.count += 1;
  buckets.set(key, bucket);
  return true;
}

function returnGuestFailureSlot(req, now = Date.now()) {
  const bucket = buckets.get(`guest-fail-ip:${clientIp(req)}`);
  if (bucket && bucket.resetAt > now && bucket.count > 0) bucket.count -= 1;
}

function sendJson(res, status, payload, rate = null) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (rate) {
    res.setHeader('X-RateLimit-Limit', String(rate.limit));
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));
  }
  res.end(JSON.stringify(payload));
}

function sendError(res, id, error) {
  const known = error instanceof CaptionStoreError;
  const status = known ? error.status : 500;
  const code = known ? error.code : 'INTERNAL_ERROR';
  const message = known ? error.message : 'Caption service encountered an error';
  sendJson(res, status, { ok: false, requestId: id, error: { code, message } });
}

module.exports = { MAX_BODY_BYTES, requestId, bearerToken, assertOrigin, parseBody, rateLimit, guestRateLimit,
  GUEST_FAILURES_PER_MINUTE, takeGuestFailureSlot, returnGuestFailureSlot, sendJson, sendError, allowedOrigins };
