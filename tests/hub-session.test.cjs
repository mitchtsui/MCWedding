'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/hub-session.js');
const { COOKIE_NAME, LOGIN_FAILURE_LIMIT, SESSION_TTL_MS, createHubAuth, verifyHubSession } = require('../lib/hub-auth.cjs');
const { COOKIE_NAME: OPERATOR_COOKIE } = require('../lib/captions/operator-auth.cjs');

const PASSWORD = 'door';
const SECRET = 'abcdef0123456789abcdef0123456789abcdef0123456789';
const ENV = { WEDDING_HUB_PASSWORD: PASSWORD, WEDDING_HUB_SESSION_SECRET: SECRET };

function req({ method = 'GET', body, cookie = '', origin = 'https://wedding.test', ip = '203.0.113.90' } = {}) {
  const headers = { cookie, origin, host: 'wedding.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': ip };
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(JSON.stringify(body)));
  return { method, body, headers, socket: { remoteAddress: ip } };
}

function res() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; } };
}

async function call(handler, options) {
  const response = res();
  await handler(req(options), response);
  return { status: response.statusCode, headers: response.headers, body: JSON.parse(response.body) };
}

const pair = value => String(value).split(';', 1)[0];

test('four-character hub password creates a distinct secure session and reusable verification accepts it', async () => {
  const clock = Date.UTC(2026, 9, 13, 12);
  const handler = createHandler({ env: ENV, now: () => clock });
  const login = await call(handler, { method: 'POST', body: { action: 'login', password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body, { ok: true, data: { authenticated: true,
    expiresAt: new Date(clock + SESSION_TTL_MS).toISOString() } });
  assert.notEqual(COOKIE_NAME, OPERATOR_COOKIE);
  assert.match(login.headers['Set-Cookie'], new RegExp(`^${COOKIE_NAME}=`));
  assert.match(login.headers['Set-Cookie'], /; Path=\/; Max-Age=28800;/);
  assert.match(login.headers['Set-Cookie'], /; HttpOnly; Secure; SameSite=Strict$/);
  const cookie = pair(login.headers['Set-Cookie']);
  const verified = verifyHubSession(req({ cookie }), { env: ENV, now: () => clock });
  assert.equal(verified.authenticated, true);
  assert.equal(verified.scope, 'wedding-hub:view');
  assert.equal(typeof verified.sessionId, 'string');
  const middlewareStyle = verifyHubSession({ headers: new Headers({ cookie }) }, { env: ENV, now: () => clock });
  assert.equal(middlewareStyle.authenticated, true, 'the reusable verifier accepts the standard Headers interface used by middleware');
  const status = await call(handler, { cookie });
  assert.deepEqual(status.body.data, { authenticated: true, expiresAt: new Date(clock + SESSION_TTL_MS).toISOString() });
});

test('hub auth fails closed for missing, undersized, oversized or shared configuration values', async () => {
  for (const env of [
    { ...ENV, WEDDING_HUB_PASSWORD: '' },
    { ...ENV, WEDDING_HUB_PASSWORD: 'abc' },
    { ...ENV, WEDDING_HUB_PASSWORD: 'x'.repeat(1025) },
    { ...ENV, WEDDING_HUB_SESSION_SECRET: '' },
    { ...ENV, WEDDING_HUB_SESSION_SECRET: 'short' },
    { ...ENV, WEDDING_HUB_PASSWORD: SECRET },
  ]) {
    const handler = createHandler({ env });
    const status = await call(handler, {});
    assert.equal(status.status, 503);
    assert.equal(status.body.error.code, 'HUB_AUTH_UNAVAILABLE');
    const login = await call(handler, { method: 'POST', body: { action: 'login', password: PASSWORD } });
    assert.equal(login.status, 503);
  }
});

test('tamper, expiry, password rotation and secret rotation invalidate hub sessions', async () => {
  for (const mode of ['tamper', 'expiry', 'password', 'secret']) {
    let clock = Date.UTC(2026, 9, 13, 12);
    const env = { ...ENV }, auth = createHubAuth({ env, now: () => clock });
    const signed = auth.login(req({ method: 'POST' }), PASSWORD), original = pair(signed.cookie);
    let cookie = original;
    if (mode === 'tamper') cookie = original.slice(0, -1) + (original.endsWith('A') ? 'B' : 'A');
    if (mode === 'expiry') clock += SESSION_TTL_MS;
    if (mode === 'password') env.WEDDING_HUB_PASSWORD += 'x';
    if (mode === 'secret') env.WEDDING_HUB_SESSION_SECRET += 'x';
    const handler = createHandler({ env, now: () => clock });
    const status = await call(handler, { cookie });
    assert.equal(status.status, 200, mode);
    assert.deepEqual(status.body.data, { authenticated: false, expiresAt: null }, mode);
    assert.match(status.headers['Set-Cookie'], /Max-Age=0/, mode);
  }
});

test('wrong hub passwords lock one IP while another IP can authenticate', async () => {
  const handler = createHandler({ env: ENV });
  for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
    const denied = await call(handler, { method: 'POST', body: { action: 'login', password: 'nope' } });
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error.code, 'INVALID_CREDENTIALS');
  }
  assert.equal((await call(handler, { method: 'POST', body: { action: 'login', password: PASSWORD } })).status, 429);
  assert.equal((await call(handler, { method: 'POST', ip: '203.0.113.91', body: { action: 'login', password: PASSWORD } })).status, 200);
});

test('hub mutations require exact same origin and logout clears without valid configuration', async () => {
  const handler = createHandler({ env: ENV });
  const cross = await call(handler, { method: 'POST', origin: 'https://evil.example', body: { action: 'login', password: PASSWORD } });
  assert.equal(cross.status, 403);
  assert.equal(cross.body.error.code, 'ORIGIN_FORBIDDEN');
  const wrongAction = await call(handler, { method: 'POST', body: { action: 'status' } });
  assert.equal(wrongAction.status, 400);
  const logoutHandler = createHandler({ env: {} });
  const logout = await call(logoutHandler, { method: 'POST', cookie: `${COOKIE_NAME}=stale`, body: { action: 'logout' } });
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.body.data, { authenticated: false, expiresAt: null });
  assert.equal(logout.headers['Set-Cookie'].length, 2);
  assert.match(logout.headers['Set-Cookie'][0], new RegExp(`^${COOKIE_NAME}=.*Max-Age=0`));
  assert.match(logout.headers['Set-Cookie'][1], new RegExp(`^${OPERATOR_COOKIE}=.*Max-Age=0`));
});
