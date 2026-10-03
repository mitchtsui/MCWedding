'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { randomUUID } = crypto;
const { createHandler, createGuestReadCache } = require('../api/captions.js');
const { MAX_BODY_BYTES, parseBody, guestRateLimit, GUEST_FAILURES_PER_MINUTE } = require('../lib/captions/http.cjs');
const { createGuestSigner } = require('../lib/captions/guest-link.cjs');

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

test('config is safe before sign-in and reports guest links off by default', async () => {
  let called = false;
  const handler = createHandler({ env: baseEnv, fetchImpl: async () => { called = true; } });
  const res = mockRes();
  await handler(mockReq({ authorization: '' }), res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.data.enabled, true);
  assert.equal(body.data.guestLinksReady, false);
  assert.deepEqual(body.data.supportedLanguages, ['en','ja','zh-CN']);
  assert.equal(called, false);
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

test('End reports recognized final sources still missing a target translation but excludes manual target-only captions', async () => {
  const urls = [];
  const ended = await post(adminFetch({
    '/rpc/caption_transition_run': { status: 200, body: { run_id: RUN_ID, event_id: EVENT_ID, state: 'ended', delivery_outbox_ids: [] } },
    '/rpc/caption_recover_pending': { status: 200, body: { finalSources: [
      { segmentId:'s-1', text:'recognized one' }, { segmentId:'s-2', text:'recognized two' },
      { segmentId:'manual-target-only', text:'' }
    ] } }
  }, urls), { action: 'end', runId: RUN_ID });
  assert.equal(ended.status, 200);
  assert.deepEqual({ pendingRecognizedFinalSources: ended.body.data.pendingRecognizedFinalSources,
    pendingRecognizedFinalsTruncated: ended.body.data.pendingRecognizedFinalsTruncated,
    pendingRecognizedFinalsChecked: ended.body.data.pendingRecognizedFinalsChecked },
  { pendingRecognizedFinalSources: 2, pendingRecognizedFinalsTruncated: false, pendingRecognizedFinalsChecked: true });
  assert(urls.findIndex(url => url.includes('caption_transition_run')) < urls.findIndex(url => url.includes('caption_recover_pending')),
    'the ended generation is fixed before its durable pending work is counted');
});

test('End succeeds but marks pending-final completeness unknown when its durable check fails', async () => {
  const ended = await post(adminFetch({
    '/rpc/caption_transition_run': { status: 200, body: { run_id: RUN_ID, event_id: EVENT_ID, state: 'ended', delivery_outbox_ids: [] } },
    '/rpc/caption_recover_pending': { status: 503, body: { code: 'database_down' } }
  }), { action: 'end', runId: RUN_ID });
  assert.equal(ended.status, 200);
  assert.deepEqual({ pendingRecognizedFinalSources: ended.body.data.pendingRecognizedFinalSources,
    pendingRecognizedFinalsTruncated: ended.body.data.pendingRecognizedFinalsTruncated,
    pendingRecognizedFinalsChecked: ended.body.data.pendingRecognizedFinalsChecked },
  { pendingRecognizedFinalSources: null, pendingRecognizedFinalsTruncated: false, pendingRecognizedFinalsChecked: false });
});

test('End treats a malformed pending-work response as unknown instead of claiming zero', async () => {
  const ended = await post(adminFetch({
    '/rpc/caption_transition_run': { status: 200, body: { run_id: RUN_ID, event_id: EVENT_ID, state: 'ended', delivery_outbox_ids: [] } },
    '/rpc/caption_recover_pending': { status: 200, body: { finalSources: null } }
  }), { action: 'end', runId: RUN_ID });
  assert.equal(ended.status, 200);
  assert.deepEqual({ count: ended.body.data.pendingRecognizedFinalSources,
    truncated: ended.body.data.pendingRecognizedFinalsTruncated,
    checked: ended.body.data.pendingRecognizedFinalsChecked },
  { count: null, truncated: false, checked: false });
});

const SIGNING_KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const guestEnv = { ...baseEnv, CAPTIONS_GUEST_LINKS: 'true', CAPTIONS_GUEST_SIGNING_KEY: SIGNING_KEY };
const OTHER_RUN = '33333333-3333-4333-8333-333333333333';
const access = (runId = RUN_ID) => ({ status: 200, body: { event_id: EVENT_ID, run_id: runId, expires_at: '2026-11-13T04:00:00+00:00' } });
const snapshotRow = { eventId: EVENT_ID, runId: RUN_ID, currentRunId: RUN_ID, modeGeneration: 1, channelEpoch: 'epoch', messageSeq: 4,
  status: 'live', language: 'ja', topic: `caption:${EVENT_ID}:ja`, updates: [] };

const SERVER_TIME = 1794470400000;

function routedFetch(routes, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    const [, answer] = Object.entries(routes).find(([suffix]) => url.endsWith(suffix)) || [];
    if (!answer) throw new Error(`unexpected ${url}`);
    return { ok: answer.status < 300, status: answer.status, text: async () => JSON.stringify(answer.body ?? {}) };
  };
}

// A guest phone: no Authorization header, its own device id, one hotel IP.
async function sendGuest(handler, body = {}, ip = '203.0.113.7') {
  const req = mockReq({ method: 'POST', authorization: '', body: { action: 'guestSnapshot', eventId: EVENT_ID, token: 'qr-token', language: 'ja',
    deviceId: `phone-${randomUUID()}`, ...body } });
  req.headers['x-forwarded-for'] = ip;
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body), raw: res.body };
}

async function guestPost({ env = guestEnv, routes = {}, body = {}, calls = [], ip = '203.0.113.7' }) {
  const reply = await sendGuest(createHandler({ env, fetchImpl: routedFetch(routes, calls), now: () => SERVER_TIME }), body, ip);
  return { ...reply, calls };
}

test('guestSnapshot serves the snapshot, signed guest topic and public key with no Authorization header', async () => {
  const signer = createGuestSigner(guestEnv);
  const reply = await guestPost({ routes: { '/rpc/caption_guest_access': access(), '/rpc/caption_snapshot': { status: 200, body: snapshotRow } } });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data, { ...snapshotRow, currentRunId: RUN_ID, guestTopic: signer.topicFor(EVENT_ID, 'ja'),
    publicKey: signer.publicJwk, expiresAt: '2026-11-13T04:00:00+00:00', serverTime: SERVER_TIME });
  assert.deepEqual(reply.calls.map(call => new URL(call.url).pathname), ['/rest/v1/rpc/caption_guest_access', '/rest/v1/rpc/caption_snapshot']);
  assert(reply.calls.every(call => call.options.headers.Authorization === 'Bearer server-secret'), 'the database is asked as the service role');
  assert.deepEqual(JSON.parse(reply.calls[0].options.body), { p_event_id: EVENT_ID, p_token: 'qr-token' });
  assert.deepEqual(JSON.parse(reply.calls[1].options.body), { p_event_id: EVENT_ID, p_run_id: RUN_ID, p_language: 'ja' });
  const privateJwk = crypto.createPrivateKey({ key: Buffer.from(SIGNING_KEY, 'base64'), format: 'der', type: 'pkcs8' }).export({ format: 'jwk' });
  assert.equal(reply.raw.includes(SIGNING_KEY), false); assert.equal(reply.raw.includes(privateJwk.d), false);
  assert.equal('d' in reply.body.data.publicKey, false);
});

test('guestSnapshot waits for a run, and refuses invalid links, foreign runs and malformed ids', async () => {
  const signer = createGuestSigner(guestEnv);
  const waiting = await guestPost({ routes: { '/rpc/caption_guest_access': access(null) }, body: { language: 'en' } });
  assert.equal(waiting.status, 200);
  assert.deepEqual(waiting.body.data, { waiting: true, eventId: EVENT_ID, language: 'en', currentRunId: null,
    guestTopic: signer.topicFor(EVENT_ID, 'en'), publicKey: signer.publicJwk, expiresAt: '2026-11-13T04:00:00+00:00', serverTime: SERVER_TIME });
  assert.equal(waiting.calls.length, 1, 'no snapshot without a run');
  for (const status of [403, 400]) {
    const refused = await guestPost({ routes: { '/rpc/caption_guest_access': { status, body: { code: '28000', message: 'guest link unavailable' } } } });
    assert.equal(refused.status, 403); assert.equal(refused.body.error.code, 'GUEST_LINK_INVALID');
    assert.equal(refused.body.error.message, 'This guest link has expired or is not valid'); assert.equal(refused.calls.length, 1);
  }
  const named = await guestPost({ routes: { '/rpc/caption_guest_access': access(), '/rpc/caption_snapshot': { status: 200, body: snapshotRow } },
    body: { runId: OTHER_RUN } });
  assert.equal(named.status, 200); assert.equal(named.body.data.runId, RUN_ID);
  assert.equal(JSON.parse(named.calls[1].options.body).p_run_id, RUN_ID, 'with a current run, the run the phone names is not looked up');
  const foreign = await guestPost({ routes: { '/rpc/caption_guest_access': access(null), '/rpc/caption_snapshot': { status: 400, body: { code: 'P0002' } } },
    body: { runId: OTHER_RUN } });
  assert.equal(foreign.status, 404); assert.equal(foreign.body.error.code, 'NOT_FOUND');
  assert.equal(JSON.parse(foreign.calls[1].options.body).p_run_id, OTHER_RUN);
  for (const body of [{ eventId: 'event-1' }, { runId: 'run-1' }, { language: 'fr' }, { token: '' }, { token: 'x'.repeat(513) }]) {
    const invalid = await guestPost({ routes: {}, body });
    assert.equal(invalid.status, 400, JSON.stringify(body).slice(0, 40)); assert.equal(invalid.body.error.code, 'INVALID_REQUEST');
    assert.equal(invalid.calls.length, 0);
  }
});

test('guest links answer 503 until switched on with a valid key, and config and preflight say which', async () => {
  for (const env of [baseEnv, { ...baseEnv, CAPTIONS_GUEST_LINKS: 'true' }, { ...guestEnv, CAPTIONS_GUEST_LINKS: 'false' },
    { ...guestEnv, CAPTIONS_GUEST_SIGNING_KEY: 'not-a-key' }]) {
    const disabled = await guestPost({ env });
    assert.equal(disabled.status, 503); assert.equal(disabled.body.error.code, 'GUEST_LINKS_DISABLED'); assert.equal(disabled.calls.length, 0);
  }
  for (const [env, ready] of [[baseEnv, false], [guestEnv, true]]) {
    const config = mockRes(); await createHandler({ env, fetchImpl: async () => { throw new Error('config must not call out'); } })(mockReq({ authorization: '' }), config);
    assert.equal(JSON.parse(config.body).data.guestLinksReady, ready);
    const preflight = mockRes();
    await createHandler({ env, fetchImpl: fetchFor({ admin: true, rpc: { caption_health: { database: true } } }) })(mockReq({ method: 'POST', body: { action: 'preflight' } }), preflight);
    const data = JSON.parse(preflight.body).data;
    assert.equal(data.guestLinksReady, ready); assert.deepEqual(data.warnings, ready ? [] : ['Guest links are switched off.']);
    assert.equal('guestAuthReady' in data, false);
  }
  const redeem = mockRes(); await createHandler({ env: guestEnv, fetchImpl: fetchFor() })(mockReq({ method: 'POST', body: { action: 'redeem', eventId: EVENT_ID, token: 't' } }), redeem);
  assert.equal(redeem.statusCode, 404); assert.equal(JSON.parse(redeem.body).error.code, 'UNKNOWN_ACTION');
});

test('one guest device is limited to 60 snapshots a minute without blocking other phones on the hotel IP', async () => {
  const routes = { '/rpc/caption_guest_access': access(), '/rpc/caption_snapshot': { status: 200, body: snapshotRow } };
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`, deviceId = `phone-${randomUUID()}`;
  for (let call = 0; call < 60; call += 1) assert.equal((await guestPost({ routes, ip, body: { deviceId } })).status, 200);
  const limited = await guestPost({ routes, ip, body: { deviceId } });
  assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'RATE_LIMITED'); assert.equal(limited.calls.length, 0);
  assert.equal((await guestPost({ routes, ip })).status, 200, 'another device on the same IP');
});

test('phones polling one link together cost one database read every few seconds, and concurrent requests share it', async () => {
  const calls = [], count = name => calls.filter(call => call.url.endsWith(`/rpc/${name}`)).length;
  let clock = SERVER_TIME;
  const handler = createHandler({ env: guestEnv, now: () => clock, fetchImpl: routedFetch({ '/rpc/caption_guest_access': access(),
    '/rpc/caption_snapshot': { status: 200, body: snapshotRow } }, calls) });
  const together = await Promise.all(Array.from({ length: 20 }, () => sendGuest(handler)));
  assert(together.every(reply => reply.status === 200 && reply.body.data.serverTime === SERVER_TIME && reply.body.data.runId === RUN_ID));
  assert.deepEqual([count('caption_guest_access'), count('caption_snapshot')], [1, 1]);
  clock += 2001; await sendGuest(handler);
  assert.deepEqual([count('caption_guest_access'), count('caption_snapshot')], [1, 2], 'snapshots are kept about two seconds');
  clock += 3000; const later = await sendGuest(handler);
  assert.deepEqual([count('caption_guest_access'), count('caption_snapshot')], [2, 3], 'link checks are kept about five seconds');
  assert.equal(later.body.data.serverTime, clock, 'serverTime is never cached');
  await sendGuest(handler, { language: 'en' });
  assert.deepEqual([count('caption_guest_access'), count('caption_snapshot')], [2, 4], 'each language has its own snapshot');
});

test('a flood of one bad guest link is answered from the cache, but a database outage is never cached', async () => {
  const calls = []; let clock = SERVER_TIME;
  const refusing = createHandler({ env: guestEnv, now: () => clock,
    fetchImpl: routedFetch({ '/rpc/caption_guest_access': { status: 403, body: { code: '28000' } } }, calls) });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const reply = await sendGuest(refusing, { token: 'guessed-token' });
    assert.equal(reply.status, 403); assert.equal(reply.body.error.code, 'GUEST_LINK_INVALID');
  }
  assert.equal(calls.length, 1);
  clock += 5001; await sendGuest(refusing, { token: 'guessed-token' });
  assert.equal(calls.length, 2);
  const outage = [], down = createHandler({ env: guestEnv, fetchImpl: routedFetch({ '/rpc/caption_guest_access': { status: 503, body: {} } }, outage) });
  for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await sendGuest(down)).status, 503);
  assert.equal(outage.length, 2);
});

test('the guest read cache is bounded and drops expired entries before fresh ones', async () => {
  let clock = 0, loads = 0;
  const cache = createGuestReadCache({ max: 3, now: () => clock });
  const read = (key, ttl = 1000) => cache.read(key, ttl, async () => { loads += 1; return key; });
  await read('short', 10); await read('a'); await read('b');
  clock = 20; await read('c');
  assert.equal(cache.size, 3);
  assert.equal(loads, 4); await read('a'); await read('b'); assert.equal(loads, 4, 'fresh entries survived; the expired one went');
  for (const key of ['d', 'e', 'f', 'g']) await read(key);
  assert.equal(cache.size, 3);
});

test('config never refuses a venue of phones scanning the QR code from one IP', async () => {
  const handler = createHandler({ env: guestEnv, fetchImpl: async () => { throw new Error('config must not call out'); } });
  const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
  for (let phone = 0; phone < 1000; phone += 1) {
    const req = mockReq({ authorization: '' }); req.headers['x-forwarded-for'] = ip;
    const res = mockRes(); await handler(req, res);
    assert.equal(res.statusCode, 200, `phone ${phone}`);
    if (phone === 0) assert.equal(res.headers['X-RateLimit-Limit'], '20000');
  }
});

test('rotating device ids spend nothing the hotel IP shares: only each device has a request limit', () => {
  const req = { headers: { 'x-forwarded-for': freshIp() }, socket: {} }, now = 1770000000000;
  for (let call = 0; call <= 20000; call += 1) assert.doesNotThrow(() => guestRateLimit(req, `rotated-${call}-${randomUUID().slice(0, 8)}`, now));
});

let ipSequence = 0;
function freshIp() { ipSequence += 1; return `100.64.${ipSequence >> 8}.${ipSequence & 255}`; }

// Answers each RPC from its name and arguments, recording every call.
function rpcFetch(answer, calls) {
  return async (url, options) => {
    const name = url.split('/').pop(), args = JSON.parse(options.body || '{}');
    calls.push({ name, args });
    const { status = 200, body } = answer(name, args);
    return { ok: status < 300, status, text: async () => JSON.stringify(body ?? {}) };
  };
}

const tally = replies => replies.reduce((counts, reply) => ({ ...counts, [reply.status]: (counts[reply.status] || 0) + 1 }), {});

test('a guessed-link flood from one IP is refused once its failure budget is spent, costing at most that many database calls', async () => {
  const calls = [], ip = freshIp();
  const handler = createHandler({ env: guestEnv, fetchImpl: rpcFetch(() => ({ status: 403, body: { code: '28000' } }), calls) });
  const flood = await Promise.all(Array.from({ length: 1000 }, (_, n) => sendGuest(handler, { token: `guess-${n}` }, ip)));
  assert.deepEqual(tally(flood), { 403: GUEST_FAILURES_PER_MINUTE, 429: 1000 - GUEST_FAILURES_PER_MINUTE });
  assert.equal(calls.length, GUEST_FAILURES_PER_MINUTE, 'parallel guesses stop at the budget too');
  const after = await sendGuest(handler, { token: 'one-more-guess' }, ip);
  assert.equal(after.status, 429); assert.equal(after.body.error.code, 'RATE_LIMITED'); assert.equal(calls.length, GUEST_FAILURES_PER_MINUTE);
  assert.equal((await sendGuest(handler, { token: 'elsewhere' }, freshIp())).status, 403, 'other IPs keep their own budget');
  const malformed = freshIp();
  for (let n = 0; n < GUEST_FAILURES_PER_MINUTE; n += 1) assert.equal((await sendGuest(handler, { language: 'fr' }, malformed)).status, 400);
  const called = calls.length;
  assert.equal((await sendGuest(handler, { token: 'after-bad-input' }, malformed)).status, 429, 'bad input spends the budget');
  assert.equal(calls.length, called);
  const outage = [], down = createHandler({ env: guestEnv, fetchImpl: rpcFetch(() => ({ status: 503 }), outage) }), outageIp = freshIp();
  for (let n = 0; n <= GUEST_FAILURES_PER_MINUTE; n += 1) assert.equal((await sendGuest(down, { token: `outage-${n}` }, outageIp)).status, 503);
  assert.equal(outage.length, GUEST_FAILURES_PER_MINUTE + 1, 'server failures are not the client\'s and spend nothing');
});

test('phones holding the real link on the same IP get answers before and after a flood spends the failure budget', async () => {
  let clock = SERVER_TIME, revoked = false; const calls = [], ip = freshIp();
  const handler = createHandler({ env: guestEnv, now: () => clock, fetchImpl: rpcFetch((name, args) => name === 'caption_snapshot'
    ? { status: 200, body: snapshotRow } : args.p_token === 'qr-token' && !revoked ? access() : { status: 403, body: { code: '28000' } }, calls) });
  const linkChecks = () => calls.filter(call => call.name === 'caption_guest_access' && call.args.p_token === 'qr-token').length;
  assert.equal((await sendGuest(handler, {}, ip)).status, 200, 'before the flood');
  await Promise.all(Array.from({ length: 700 }, (_, n) => sendGuest(handler, { token: `guess-${n}` }, ip)));
  assert.equal((await sendGuest(handler, { token: 'one-more-guess' }, ip)).status, 429, 'the budget is spent');
  const during = await Promise.all(Array.from({ length: 50 }, () => sendGuest(handler, {}, ip)));
  assert.deepEqual(tally(during), { 200: 50 });
  clock += 5001;
  const checked = linkChecks();
  assert.equal((await sendGuest(handler, {}, ip)).status, 200, 'after the five-second link check expires');
  assert.equal(linkChecks(), checked + 1, 'the link was checked against the database again, not waved through');
  revoked = true; clock += 5001;
  assert.equal((await sendGuest(handler, {}, ip)).status, 403, 'a link revoked since is refused on the next check');
  assert.equal((await sendGuest(handler, {}, ip)).status, 429, 'and loses its exemption from the spent budget');
});

test('with a current run, 2000 requests naming made-up runs cost no database calls beyond the cached snapshot', async () => {
  const calls = [];
  const handler = createHandler({ env: guestEnv, now: () => SERVER_TIME, fetchImpl: rpcFetch(name => name === 'caption_guest_access' ? access()
    : { status: 200, body: snapshotRow }, calls) });
  const replies = await Promise.all(Array.from({ length: 2000 }, () => sendGuest(handler, { runId: randomUUID() }, freshIp())));
  assert(replies.every(reply => reply.status === 200 && reply.body.data.runId === RUN_ID && reply.body.data.currentRunId === RUN_ID));
  assert.deepEqual(calls.map(call => [call.name, call.args.p_run_id]), [['caption_guest_access', undefined], ['caption_snapshot', RUN_ID]]);
});

test('with no current run, a run of the event is served and a foreign or made-up run is 404, kept briefly and counted', async () => {
  const calls = [], ip = freshIp();
  const handler = createHandler({ env: guestEnv, now: () => SERVER_TIME, fetchImpl: rpcFetch((name, args) => name === 'caption_guest_access' ? access(null)
    : args.p_run_id === RUN_ID ? { status: 200, body: { ...snapshotRow, currentRunId: null, status: 'ended' } } : { status: 400, body: { code: 'P0002' } }, calls) });
  const lookups = runId => calls.filter(call => call.name === 'caption_snapshot' && call.args.p_run_id === runId).length;
  const ended = await sendGuest(handler, { runId: RUN_ID }, ip);
  assert.equal(ended.status, 200); assert.equal(ended.body.data.runId, RUN_ID); assert.equal(ended.body.data.currentRunId, null);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const foreign = await sendGuest(handler, { runId: OTHER_RUN }, ip);
    assert.equal(foreign.status, 404); assert.equal(foreign.body.error.code, 'NOT_FOUND');
  }
  assert.equal(lookups(OTHER_RUN), 1, 'a refused run is kept for two seconds');
  for (let n = 0; n < GUEST_FAILURES_PER_MINUTE; n += 1) await sendGuest(handler, { runId: randomUUID() }, ip);
  const called = calls.length;
  assert.equal((await sendGuest(handler, { runId: randomUUID() }, ip)).status, 429, 'made-up runs spend the budget even with the real link');
  assert.equal(calls.length, called);
  assert.equal((await sendGuest(handler, { runId: RUN_ID }, ip)).status, 200, 'the phone that knew the run still reads it');
  assert.equal((await sendGuest(handler, {}, ip)).body.data.waiting, true);
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

test('a hotel of guest phones behind one IP can poll every ten seconds while each device is held to its own limit', () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 100) + 100}`, run = randomUUID().slice(0, 8);
  const now = 1770000000000, req = { headers: { 'x-forwarded-for': ip }, socket: {} };
  for (let guest = 0; guest < 160; guest += 1) {
    for (let poll = 0; poll < 6; poll += 1) assert.doesNotThrow(() => guestRateLimit(req, `phone-${run}-${guest}`, now + poll * 10000));
  }
  for (let call = 0; call < 54; call += 1) guestRateLimit(req, `phone-${run}-0`, now + 1000);
  assert.throws(() => guestRateLimit(req, `phone-${run}-0`, now + 1000), error => error.code === 'RATE_LIMITED' && error.status === 429);
  assert.doesNotThrow(() => guestRateLimit(req, `phone-${run}-1`, now + 1000), 'another phone on the same IP is unaffected');
  const shared = { headers: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 90) + 5}` }, socket: {} };
  for (let call = 0; call < 60; call += 1) guestRateLimit(shared, 'bad id!', now);
  assert.throws(() => guestRateLimit(shared, undefined, now), error => error.code === 'RATE_LIMITED', 'without a valid device id the IP is the device');
});
