'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/captions.js');
const { COOKIE_NAME, LOGIN_FAILURE_LIMIT, OPERATOR_ID, SESSION_TTL_MS } = require('../lib/captions/operator-auth.cjs');
const { createHubAuth } = require('../lib/hub-auth.cjs');

const PASSWORD = 'correct horse battery staple';
const SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
const HUB_PASSWORD = 'door';
const HUB_SECRET = 'abcdef0123456789abcdef0123456789abcdef0123456789';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const SCRIPT_ID = '33333333-3333-4333-8333-333333333333';
const CUE_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const BASE_ENV = {
  CAPTIONS_ENABLED: 'true',
  CAPTIONS_ALLOWED_ORIGINS: 'https://wedding.test',
  CAPTIONS_OPERATOR_PASSWORD: PASSWORD,
  CAPTIONS_OPERATOR_SESSION_SECRET: SESSION_SECRET,
  WEDDING_HUB_PASSWORD: HUB_PASSWORD,
  WEDDING_HUB_SESSION_SECRET: HUB_SECRET,
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
};

function request({ method = 'GET', url = '/api/captions.js?action=operatorStatus', body, origin = 'https://wedding.test',
  cookie = '', authorization = '', ip = '203.0.113.60' } = {}) {
  const headers = { origin, cookie, authorization, host: 'wedding.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': ip };
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(JSON.stringify(body)));
  return { method, url, body, headers, socket: { remoteAddress: ip } };
}

function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; } };
}

async function call(handler, options) {
  const res = response();
  await handler(request(options), res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

async function login(handler, password = PASSWORD, options = {}) {
  return call(handler, { method: 'POST', cookie: hubCookie(), body: { action: 'operatorLogin', password }, ...options });
}

function cookiePair(setCookie) {
  return String(setCookie).split(';', 1)[0];
}

function hubCookie(now = Date.now) {
  return cookiePair(createHubAuth({ env: BASE_ENV, now }).login(request({ method: 'POST' }), HUB_PASSWORD).cookie);
}

function both(hub, operator) { return `${hub}; ${operator}`; }

function serviceFetch(calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const name = url.split('/').pop();
    const bodies = {
      caption_health: { database: 'ok' },
      caption_create_event: { event_id: EVENT_ID },
      caption_start_run: { event_id: EVENT_ID, run_id: RUN_ID, state: 'live' },
      caption_transition_run: { event_id: EVENT_ID, run_id: RUN_ID, state: 'paused', delivery_outbox_ids: [] },
      caption_issue_uplink_ticket: { token: 'one-use', user_id: OPERATOR_ID },
      caption_snapshot: { event_id: EVENT_ID, run_id: RUN_ID, language: 'en', updates: [] },
      caption_create_invite: { token: 'guest-link' },
      caption_manual_publish: { run_id: RUN_ID, delivery_outbox_ids: [] },
      caption_review_suggestion: { review_id: 'review-1' },
      caption_upsert_glossary: { id: 'glossary-1' },
      caption_list_scripts: { scripts: [] },
      caption_upsert_script: { scripts: [{ id: SCRIPT_ID, title: 'Speech', content: 'Welcome', sequence: 0, active: false, revision: 1 }] },
      caption_select_scripts: { scripts: [] },
      caption_prepared_context: { script_id: SCRIPT_ID, script_revision: 1, content: 'Welcome.', glossary: [], prepared: { status: 'empty', cues: [] } },
      caption_sync_prepared_cues: { status: 'ready', cues: [] },
      caption_update_prepared_cue: { status: 'ready', cues: [] },
      caption_review_prepared_cue: { status: 'ready', cues: [] },
      caption_select_prepared_script: { run_id: RUN_ID, script_id: SCRIPT_ID, script_revision: 1, state_revision: 1, cursor: -1 },
      caption_get_prepared_run: { run_id: RUN_ID, script_id: SCRIPT_ID, script_revision: 1, state_revision: 1, cursor: -1 },
      caption_publish_prepared_cue: { run_id: RUN_ID, script_id: SCRIPT_ID, script_revision: 1, state_revision: 2, cursor: 0, delivery_outbox_ids: [] },
      caption_clear_prepared: { run_id: RUN_ID, script_id: SCRIPT_ID, script_revision: 1, state_revision: 3, cursor: 0, delivery_outbox_ids: [] },
      caption_recover_pending: { final_sources: [] },
    };
    if (!(name in bodies)) throw new Error(`unexpected ${url}`);
    return { ok: true, status: 200, text: async () => JSON.stringify(bodies[name]) };
  };
}

test('operator auth fails closed when password or signing-secret configuration is missing or weak', async () => {
  for (const env of [
    { ...BASE_ENV, CAPTIONS_OPERATOR_PASSWORD: '' },
    { ...BASE_ENV, CAPTIONS_OPERATOR_PASSWORD: 'short' },
    { ...BASE_ENV, CAPTIONS_OPERATOR_SESSION_SECRET: '' },
    { ...BASE_ENV, CAPTIONS_OPERATOR_SESSION_SECRET: 'short' },
    { ...BASE_ENV, CAPTIONS_OPERATOR_SESSION_SECRET: PASSWORD },
  ]) {
    let called = false;
    const handler = createHandler({ env, fetchImpl: async () => { called = true; } });
    const status = await call(handler, { cookie: hubCookie() });
    assert.equal(status.status, 503);
    assert.equal(status.body.error.code, 'OPERATOR_AUTH_UNAVAILABLE');
    const attempt = await login(handler);
    assert.equal(attempt.status, 503);
    assert.equal(attempt.body.error.code, 'OPERATOR_AUTH_UNAVAILABLE');
    assert.equal(called, false);
  }
  const exactEnv = { ...BASE_ENV, CAPTIONS_OPERATOR_PASSWORD: '123456' };
  const exactHandler = createHandler({ env: exactEnv, fetchImpl: async () => { throw new Error('must not call Supabase'); } });
  const exact = await call(exactHandler, { method: 'POST', cookie: hubCookie(),
    body: { action: 'operatorLogin', password: '123456' } });
  assert.equal(exact.status, 200, 'the user-approved six-character caption password length is accepted');
});

test('login sets only a signed secure HttpOnly cookie and status accepts it without Supabase', async () => {
  let called = false, clock = Date.now();
  const handler = createHandler({ env: BASE_ENV, now: () => clock, fetchImpl: async () => { called = true; } });
  const hub = hubCookie(() => clock), signedIn = await login(handler, PASSWORD, { cookie: hub });
  assert.equal(signedIn.status, 200);
  assert.deepEqual(signedIn.body.data, { authenticated: true, expiresAt: new Date(clock + SESSION_TTL_MS).toISOString() });
  const setCookie = signedIn.headers['Set-Cookie'];
  assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(setCookie, /; Path=\/; Max-Age=28800;/);
  assert.match(setCookie, /; HttpOnly; Secure; SameSite=Strict$/);
  assert.doesNotMatch(setCookie, new RegExp(PASSWORD.replaceAll(' ', '.')));
  const status = await call(handler, { cookie: both(hub, cookiePair(setCookie)) });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.data, { authenticated: true, expiresAt: new Date(clock + SESSION_TTL_MS).toISOString() });
  assert.equal(called, false);
});

test('missing and wrong passwords are generic failures and repeated guesses lock one IP', async () => {
  const handler = createHandler({ env: BASE_ENV, fetchImpl: async () => { throw new Error('must not call Supabase'); } });
  for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
    const refused = await login(handler, attempt ? 'definitely wrong password' : null);
    assert.equal(refused.status, 401);
    assert.equal(refused.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal('Set-Cookie' in refused.headers, false);
  }
  const locked = await login(handler, PASSWORD);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'RATE_LIMITED');
  const otherIp = await login(handler, PASSWORD, { ip: '203.0.113.61' });
  assert.equal(otherIp.status, 200);
});

test('tampered and expired sessions are rejected, cleared, and cannot protect an operator action', async () => {
  let clock = Date.now();
  const calls = [], handler = createHandler({ env: BASE_ENV, now: () => clock, fetchImpl: serviceFetch(calls) });
  let hub = hubCookie(() => clock);
  const signedIn = await login(handler, PASSWORD, { cookie: hub }), valid = cookiePair(signedIn.headers['Set-Cookie']);
  const tampered = valid.slice(0, -1) + (valid.endsWith('A') ? 'B' : 'A');
  const tamperedStatus = await call(handler, { cookie: both(hub, tampered) });
  assert.deepEqual(tamperedStatus.body.data, { authenticated: false, expiresAt: null });
  assert.match(tamperedStatus.headers['Set-Cookie'], /Max-Age=0/);
  const deniedTamper = await call(handler, { method: 'POST', cookie: both(hub, tampered), body: { action: 'health' } });
  assert.equal(deniedTamper.status, 401);
  assert.equal(deniedTamper.body.error.code, 'UNAUTHENTICATED');
  clock += SESSION_TTL_MS;
  hub = hubCookie(() => clock);
  const expiredStatus = await call(handler, { cookie: both(hub, valid) });
  assert.deepEqual(expiredStatus.body.data, { authenticated: false, expiresAt: null });
  const deniedExpired = await call(handler, { method: 'POST', cookie: both(hub, valid), body: { action: 'health' } });
  assert.equal(deniedExpired.status, 401);
  assert.equal(calls.length, 0);
});

test('rotating either server password or signing secret invalidates existing sessions', async () => {
  for (const field of ['CAPTIONS_OPERATOR_PASSWORD', 'CAPTIONS_OPERATOR_SESSION_SECRET']) {
    const env = { ...BASE_ENV };
    const handler = createHandler({ env, fetchImpl: async () => { throw new Error('must not call Supabase'); } });
    const hub = hubCookie(), signedIn = await login(handler, PASSWORD, { cookie: hub }), cookie = cookiePair(signedIn.headers['Set-Cookie']);
    env[field] += '-rotated-value';
    const status = await call(handler, { cookie: both(hub, cookie) });
    assert.deepEqual(status.body.data, { authenticated: false, expiresAt: null }, field);
    assert.match(status.headers['Set-Cookie'], /Max-Age=0/);
  }
});

test('password session grants caption actions, snapshots and uplink tickets only through the server role', async () => {
  const calls = [], handler = createHandler({ env: BASE_ENV, fetchImpl: serviceFetch(calls) });
  const hub = hubCookie(), signedIn = await login(handler, PASSWORD, { cookie: hub });
  const cookie = both(hub, cookiePair(signedIn.headers['Set-Cookie']));
  const actions = [
    { action: 'preflight' },
    { action: 'createEvent', title: 'Wedding live captions' },
    { action: 'start', eventId: EVENT_ID, mode: 'live' },
    { action: 'pause', runId: RUN_ID },
    { action: 'resume', runId: RUN_ID },
    { action: 'end', runId: RUN_ID },
    { action: 'stop', runId: RUN_ID },
    { action: 'ticket', runId: RUN_ID, origin: 'https://wedding.test' },
    { action: 'invite', eventId: EVENT_ID, expiresAt: '2099-11-13T04:00:00Z', maxUses: 60 },
    { action: 'manual', runId: RUN_ID, language: 'en', text: 'Reviewed caption' },
    { action: 'review', reviewId: 'review-1', decision: 'approve' },
    { action: 'glossary', eventId: EVENT_ID, entry: { sourceTerm: 'Chambolle' } },
    { action: 'scripts', eventId: EVENT_ID },
    { action: 'script', eventId: EVENT_ID, script: { title: 'Speech', content: 'Welcome' } },
    { action: 'select-scripts', eventId: EVENT_ID, scriptIds: [SCRIPT_ID] },
    { action: 'prepared-cues', eventId: EVENT_ID, scriptId: SCRIPT_ID },
    { action: 'prepare-script', eventId: EVENT_ID, scriptId: SCRIPT_ID },
    { action: 'prepared-cue', eventId: EVENT_ID, cue: { id: CUE_ID, revision: 1, en: 'English', ja: 'Japanese', 'zh-CN': 'Chinese' } },
    { action: 'review-prepared-cue', eventId: EVENT_ID, cueId: CUE_ID, revision: 1 },
    { action: 'select-prepared-script', runId: RUN_ID, scriptId: SCRIPT_ID },
    { action: 'prepared-run', runId: RUN_ID },
    { action: 'next-prepared', runId: RUN_ID, operationId: OPERATION_ID, expectedScriptId: SCRIPT_ID,
      expectedScriptRevision: 1, expectedCursor: -1, expectedStateRevision: 1 },
    { action: 'publish-prepared-cue', runId: RUN_ID, operationId: OPERATION_ID, cueId: CUE_ID, expectedScriptId: SCRIPT_ID,
      expectedScriptRevision: 1, expectedCursor: -1, expectedStateRevision: 1 },
    { action: 'clear-prepared', runId: RUN_ID, operationId: OPERATION_ID, expectedScriptId: SCRIPT_ID,
      expectedScriptRevision: 1, expectedCursor: -1, expectedStateRevision: 1 },
    { action: 'health' },
    { action: 'snapshot', eventId: EVENT_ID, runId: RUN_ID, language: 'en' },
  ];
  for (const body of actions) assert.equal((await call(handler, { method: 'POST', cookie, body })).status, 200, body.action);
  assert.deepEqual(calls.map(value => value.url.split('/').pop()), ['caption_health', 'caption_create_event', 'caption_start_run',
    'caption_transition_run', 'caption_transition_run', 'caption_transition_run', 'caption_recover_pending', 'caption_transition_run',
    'caption_issue_uplink_ticket', 'caption_create_invite', 'caption_manual_publish', 'caption_review_suggestion',
    'caption_upsert_glossary', 'caption_list_scripts', 'caption_list_scripts', 'caption_upsert_script', 'caption_select_scripts',
    'caption_prepared_context', 'caption_prepared_context', 'caption_sync_prepared_cues', 'caption_update_prepared_cue',
    'caption_review_prepared_cue', 'caption_select_prepared_script', 'caption_get_prepared_run', 'caption_publish_prepared_cue',
    'caption_publish_prepared_cue', 'caption_clear_prepared', 'caption_health', 'caption_snapshot']);
  assert(calls.every(value => value.options.headers.Authorization === 'Bearer server-secret'));
  assert.equal(calls.some(value => value.url.includes('/auth/v1/user') || value.url.includes('/rpc/is_admin')), false);
  const unknown = await call(handler, { method: 'POST', cookie, body: { action: 'guestAdmin' } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error.code, 'UNAUTHENTICATED', 'the caption cookie grants only enumerated caption actions');
});

test('same-origin checks protect login, logout and every password-authorized mutation', async () => {
  const calls = [], handler = createHandler({ env: BASE_ENV, fetchImpl: serviceFetch(calls) });
  const crossLogin = await login(handler, PASSWORD, { origin: 'https://evil.example' });
  assert.equal(crossLogin.status, 403);
  assert.equal(crossLogin.body.error.code, 'ORIGIN_FORBIDDEN');
  const hub = hubCookie(), signedIn = await login(handler, PASSWORD, { cookie: hub });
  const cookie = both(hub, cookiePair(signedIn.headers['Set-Cookie']));
  const crossAction = await call(handler, { method: 'POST', origin: 'https://evil.example', cookie, body: { action: 'health' } });
  assert.equal(crossAction.status, 403);
  const crossLogout = await call(handler, { method: 'POST', origin: 'https://evil.example', cookie, body: { action: 'operatorLogout' } });
  assert.equal(crossLogout.status, 403);
  assert.equal('Set-Cookie' in crossLogout.headers, false);
  assert.equal(calls.length, 0);
  const allowlistedCrossOrigin = createHandler({ env: { ...BASE_ENV,
    CAPTIONS_ALLOWED_ORIGINS: 'https://wedding.test,https://other.wedding.test' }, fetchImpl: serviceFetch(calls) });
  const stillCrossSite = await login(allowlistedCrossOrigin, PASSWORD, { origin: 'https://other.wedding.test' });
  assert.equal(stillCrossSite.status, 403, 'an allowlisted CORS origin still cannot create a cookie session for another host');
});

test('caption password endpoints and actions require the independent hub session while bearer admins remain separate', async () => {
  const calls = [], handler = createHandler({ env: BASE_ENV, fetchImpl: serviceFetch(calls) });
  const noHubLogin = await call(handler, { method: 'POST', body: { action: 'operatorLogin', password: PASSWORD } });
  assert.equal(noHubLogin.status, 401); assert.equal(noHubLogin.body.error.code, 'HUB_UNAUTHENTICATED');
  const noHubStatus = await call(handler, {});
  assert.equal(noHubStatus.status, 401); assert.equal(noHubStatus.body.error.code, 'HUB_UNAUTHENTICATED');
  const hub = hubCookie(), signedIn = await login(handler, PASSWORD, { cookie: hub });
  const operatorOnly = cookiePair(signedIn.headers['Set-Cookie']);
  const noHubAction = await call(handler, { method: 'POST', cookie: operatorOnly, body: { action: 'health' } });
  assert.equal(noHubAction.status, 401); assert.equal(noHubAction.body.error.code, 'HUB_UNAUTHENTICATED');
  assert.equal(calls.length, 0);
  const bearerCalls = [];
  const bearerHandler = createHandler({ env: BASE_ENV, fetchImpl: async (url, options) => {
    bearerCalls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'admin-user' }) };
    if (url.endsWith('/rpc/is_admin')) return { ok: true, status: 200, text: async () => 'true' };
    if (url.endsWith('/rpc/caption_health')) return { ok: true, status: 200, text: async () => JSON.stringify({ database: 'ok' }) };
    throw new Error(`unexpected ${url}`);
  } });
  const bearer = await call(bearerHandler, { method: 'POST', cookie: operatorOnly, authorization: 'Bearer admin-jwt',
    body: { action: 'health' } });
  assert.equal(bearer.status, 200, 'an explicit existing bearer session wins over a leftover password cookie');
  assert.deepEqual(bearerCalls.map(value => value.url.split('/').pop()), ['user', 'is_admin', 'caption_health']);
});

test('every saved-script and prepared-manual action requires both live hub and operator sessions', async () => {
  let clock = Date.now();
  const calls = [], handler = createHandler({ env: BASE_ENV, now: () => clock, fetchImpl: serviceFetch(calls) });
  const hub = hubCookie(() => clock), signedIn = await login(handler, PASSWORD, { cookie: hub });
  const operator = cookiePair(signedIn.headers['Set-Cookie']);
  const requests = [
    { action: 'scripts', eventId: EVENT_ID },
    { action: 'script', eventId: EVENT_ID, script: { title: 'Speech', content: 'Welcome' } },
    { action: 'select-scripts', eventId: EVENT_ID, scriptIds: [] },
    { action: 'prepared-cues', eventId: EVENT_ID, scriptId: SCRIPT_ID },
    { action: 'prepare-script', eventId: EVENT_ID, scriptId: SCRIPT_ID },
    { action: 'prepared-cue', eventId: EVENT_ID, cue: { id: CUE_ID, revision: 1, en: 'E', ja: 'J', 'zh-CN': 'C' } },
    { action: 'review-prepared-cue', eventId: EVENT_ID, cueId: CUE_ID, revision: 1 },
    { action: 'select-prepared-script', runId: RUN_ID, scriptId: SCRIPT_ID },
    { action: 'prepared-run', runId: RUN_ID },
    { action: 'next-prepared', runId: RUN_ID, operationId: OPERATION_ID, expectedScriptId: SCRIPT_ID,
      expectedScriptRevision: 1, expectedCursor: -1, expectedStateRevision: 1 },
    { action: 'publish-prepared-cue', runId: RUN_ID, operationId: OPERATION_ID, cueId: CUE_ID, expectedScriptId: SCRIPT_ID,
      expectedScriptRevision: 1, expectedCursor: -1, expectedStateRevision: 1 },
    { action: 'clear-prepared', runId: RUN_ID, operationId: OPERATION_ID, expectedScriptId: SCRIPT_ID,
      expectedScriptRevision: 1, expectedCursor: -1, expectedStateRevision: 1 },
  ];
  for (const body of requests) {
    const missingHub = await call(handler, { method: 'POST', cookie: operator, body });
    assert.equal(missingHub.status, 401, `${body.action} without hub`);
    assert.equal(missingHub.body.error.code, 'HUB_UNAUTHENTICATED');
  }
  clock += SESSION_TTL_MS;
  const renewedHub = hubCookie(() => clock);
  for (const body of requests) {
    const expiredOperator = await call(handler, { method: 'POST', cookie: both(renewedHub, operator), body });
    assert.equal(expiredOperator.status, 401, `${body.action} with expired operator`);
    assert.equal(expiredOperator.body.error.code, 'UNAUTHENTICATED');
  }
  assert.equal(calls.length, 0, 'authorization failures must not reach Supabase or the translation provider');
});

test('three-language snapshot polling is limited per password session instead of the shared database actor', async () => {
  const calls = [], handler = createHandler({ env: BASE_ENV, fetchImpl: serviceFetch(calls) });
  const hub = hubCookie();
  const first = cookiePair((await login(handler, PASSWORD, { cookie: hub, ip: '203.0.113.70' })).headers['Set-Cookie']);
  const second = cookiePair((await login(handler, PASSWORD, { cookie: hub, ip: '203.0.113.70' })).headers['Set-Cookie']);
  const sessions = [both(hub, first), both(hub, second)], languages = ['en', 'ja', 'zh-CN'];
  for (let cycle = 0; cycle < 40; cycle += 1) {
    for (const cookie of sessions) for (const language of languages) {
      const reply = await call(handler, { method: 'POST', ip: '203.0.113.70', cookie,
        body: { action: 'snapshot', eventId: EVENT_ID, runId: RUN_ID, language } });
      assert.equal(reply.status, 200, `cycle ${cycle} ${language}`);
    }
  }
  for (const cookie of sessions) {
    const limited = await call(handler, { method: 'POST', ip: '203.0.113.70', cookie,
      body: { action: 'snapshot', eventId: EVENT_ID, runId: RUN_ID, language: 'en' } });
    assert.equal(limited.status, 429);
  }
  assert.equal(calls.filter(value => value.url.endsWith('/caption_snapshot')).length, 240);
  assert(calls.every(value => value.options.headers.Authorization === 'Bearer server-secret'),
    'the per-session HTTP identity never replaces the stable database actor');
});

test('logout clears the cookie even when auth configuration was removed', async () => {
  const handler = createHandler({ env: { CAPTIONS_OPERATOR_SESSION_SECRET: '' },
    fetchImpl: async () => { throw new Error('must not call Supabase'); } });
  const loggedOut = await call(handler, { method: 'POST', cookie: `${COOKIE_NAME}=stale`, body: { action: 'operatorLogout' } });
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(loggedOut.body.data, { authenticated: false, expiresAt: null });
  assert.match(loggedOut.headers['Set-Cookie'], /Max-Age=0/);
});
