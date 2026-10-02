'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/captions.js');
const { MAX_BODY_BYTES, parseBody, rateLimit } = require('../lib/captions/http.cjs');

function mockReq({ method = 'GET', url = '/api/captions.js?action=config', body, origin = 'https://wedding.test', authorization = 'Bearer user-jwt' } = {}) {
  const headers = { origin, authorization, 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}` };
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(JSON.stringify(body)));
  return { method, url, body, headers, socket: { remoteAddress: '127.0.0.1' } };
}

function mockRes() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value = '') { this.body = value; } };
}

function fetchFor({ admin = false, rpc = {} } = {}) {
  return async url => {
    if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'user-1' }) };
    if (url.endsWith('/rpc/is_admin')) return { ok: true, status: 200, text: async () => JSON.stringify(admin) };
    const name = url.split('/').pop();
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc[name] ?? {}) };
  };
}

const baseEnv = {
  CAPTIONS_ENABLED: 'true',
  CAPTIONS_ALLOWED_ORIGINS: 'https://wedding.test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret'
};

test('feature defaults off and fails clearly without calling Supabase', async () => {
  let called = false;
  const handler = createHandler({ env: {}, fetchImpl: async () => { called = true; } });
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error.code, 'CAPTIONS_DISABLED');
  assert.equal(called, false);
});

test('config is safe before sign-in and reports guest Auth audit false by default', async () => {
  let called = false;
  const handler = createHandler({ env: baseEnv, fetchImpl: async () => { called = true; } });
  const res = mockRes();
  await handler(mockReq({ authorization: '' }), res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.data.enabled, true);
  assert.equal(body.data.guestAuthReady, false);
  assert.deepEqual(body.data.supportedLanguages, ['en','ja','zh-CN']);
  assert.equal(called, false);
});

test('redeem is blocked until the explicit guest Auth audit flag is true', async () => {
  const handler = createHandler({ env: baseEnv, fetchImpl: fetchFor() });
  const req = mockReq({ method: 'POST', url: '/api/captions.js', body: { action: 'redeem', eventId: 'e', token: 'invite' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error.code, 'GUEST_AUTH_NOT_READY');
});

test('admin action requires database is_admin and does not trust request fields', async () => {
  const handler = createHandler({ env: baseEnv, fetchImpl: fetchFor({ admin: false }) });
  const req = mockReq({ method: 'POST', body: { action: 'start', eventId: 'event-1', role: 'admin' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN');
});

test('ticket binds the actual allowed request Origin', async () => {
  let ticketArgs;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'admin' }) };
    if (url.endsWith('/rpc/is_admin')) return { ok: true, status: 200, text: async () => 'true' };
    if (url.endsWith('/rpc/caption_issue_uplink_ticket')) {
      ticketArgs = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ token: 'one-time' }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  const handler = createHandler({ env: baseEnv, fetchImpl });
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { action: 'ticket', runId: 'run-1', origin: 'https://wedding.test' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(ticketArgs.p_origin, 'https://wedding.test');
});

const EVENT_ID = '11111111-1111-4111-8111-111111111111', RUN_ID = '22222222-2222-4222-8222-222222222222';

// Admin-verified fetch whose remaining answers are chosen per URL suffix; records every URL it is asked for.
function adminFetch(routes, urls = []) {
  return async url => {
    urls.push(url);
    if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'admin' }) };
    if (url.endsWith('/rpc/is_admin')) return { ok: true, status: 200, text: async () => 'true' };
    const [, answer] = Object.entries(routes).find(([suffix]) => url.includes(suffix)) || [];
    if (!answer) throw new Error(`unexpected ${url}`);
    return { ok: answer.status < 300, status: answer.status, text: async () => JSON.stringify(answer.body ?? {}) };
  };
}

async function post(fetchImpl, body) {
  const res = mockRes();
  await createHandler({ env: baseEnv, fetchImpl })(mockReq({ method: 'POST', body }), res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('a run that refuses the action answers 409 RUN_NOT_OPEN, unlike throttling or a missing run', async () => {
  const refused = { status: 400, body: { code: '22023', message: 'invalid run transition' } };
  const stopped = await post(adminFetch({ '/rpc/caption_transition_run': refused }), { action: 'stop', runId: RUN_ID });
  assert.equal(stopped.status, 409); assert.equal(stopped.body.error.code, 'RUN_NOT_OPEN');
  assert.doesNotMatch(JSON.stringify(stopped.body), /invalid run transition/);
  const ticket = await post(adminFetch({ '/rpc/caption_issue_uplink_ticket': refused }), { action: 'ticket', runId: RUN_ID });
  assert.equal(ticket.status, 409); assert.equal(ticket.body.error.code, 'RUN_NOT_OPEN');
  const throttled = await post(adminFetch({ '/rpc/caption_transition_run': { status: 429, body: { message: 'Too many requests' } } }), { action: 'stop', runId: RUN_ID });
  assert.equal(throttled.status, 400); assert.equal(throttled.body.error.code, 'INVALID_REQUEST');
  const missing = await post(adminFetch({ '/rpc/caption_transition_run': { status: 400, body: { code: 'P0002' } } }), { action: 'stop', runId: RUN_ID });
  assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('start reveals the run that is already open instead of only refusing', async () => {
  const conflict = { status: 409, body: { code: '23505', message: 'event already has an open run' } }, urls = [];
  const revealed = await post(adminFetch({ '/rpc/caption_start_run': conflict,
    '/rest/v1/caption_events?': { status: 200, body: [{ current_run_id: RUN_ID }] } }, urls), { action: 'start', eventId: EVENT_ID });
  assert.equal(revealed.status, 200);
  assert.deepEqual(revealed.body.data, { eventId: EVENT_ID, runId: RUN_ID, alreadyOpen: true });
  assert.equal(urls.at(-1), `https://test.supabase.co/rest/v1/caption_events?id=eq.${EVENT_ID}&select=current_run_id`);
  for (const lookup of [{ status: 200, body: [] }, { status: 200, body: [{ current_run_id: null }] }, { status: 503, body: {} }]) {
    const refused = await post(adminFetch({ '/rpc/caption_start_run': conflict, '/rest/v1/caption_events?': lookup }), { action: 'start', eventId: EVENT_ID });
    assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'CONFLICT');
  }
});

test('a normal start is unchanged and a non-UUID event id never reaches the lookup URL', async () => {
  const started = await post(adminFetch({ '/rpc/caption_start_run': { status: 200, body: { run_id: RUN_ID, event_id: EVENT_ID, state: 'live' } } }),
    { action: 'start', eventId: EVENT_ID });
  assert.equal(started.status, 200);
  assert.deepEqual(started.body.data, { runId: RUN_ID, eventId: EVENT_ID, state: 'live' });
  const urls = [];
  const injected = await post(adminFetch({ '/rpc/caption_start_run': { status: 409, body: { code: '23505' } } }, urls),
    { action: 'start', eventId: `${EVENT_ID}&select=*` });
  assert.equal(injected.status, 409); assert.equal(injected.body.error.code, 'CONFLICT');
  assert.equal(urls.some(url => url.includes('/rest/v1/caption_events')), false);
});

test('POST rejects missing or unlisted Origin before authentication', async () => {
  let called = false;
  const handler = createHandler({ env: baseEnv, fetchImpl: async () => { called = true; } });
  const req = mockReq({ method: 'POST', origin: 'https://evil.example', body: { action: 'health' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error.code, 'ORIGIN_FORBIDDEN');
  assert.equal(called, false);
});

test('internal errors never expose exception or secret text', async () => {
  const handler = createHandler({ env: baseEnv, fetchImpl: async () => { throw new Error('server-secret should stay hidden'); } });
  const res = mockRes();
  await handler(mockReq({ url: '/api/captions.js?action=health' }), res);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(res.body, /server-secret/);
});

test('pre-parsed JSON bodies cannot bypass the payload limit', () => {
  const req = mockReq({ method: 'POST', body: { action: 'script', content: 'x'.repeat(MAX_BODY_BYTES) } });
  assert.throws(() => parseBody(req), error => error.code === 'PAYLOAD_TOO_LARGE' && error.status === 413);
});

test('50 authenticated guests behind one venue IP can redeem once and poll every ten seconds', () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 100) + 100}`;
  const now = 1770000000000;
  for (let guest = 0; guest < 50; guest += 1) {
    const req = { headers: { 'x-forwarded-for': ip }, socket: {} };
    assert.doesNotThrow(() => rateLimit(req, 'redeem', `guest-${guest}`, now));
    for (let poll = 0; poll < 6; poll += 1) assert.doesNotThrow(() => rateLimit(req, 'snapshot', `guest-${guest}`, now + poll * 10000));
  }
});
