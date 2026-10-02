'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptionStore, CaptionStoreError } = require('../lib/captions/store.cjs');

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, text: async () => payload == null ? '' : JSON.stringify(payload) };
}

test('CaptionStore sends server credentials only to configured Supabase and camelises RPC results', async () => {
  const calls = [];
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co/', serviceRoleKey: 'server-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(200, { run_id: 'run-1', mode_generation: 2, nested_rows: [{ channel_epoch: 'epoch' }] });
  }});
  const value = await store.getRunState({ runId: 'run-1' });
  assert.deepEqual(value, { runId: 'run-1', modeGeneration: 2, nestedRows: [{ channelEpoch: 'epoch' }] });
  assert.equal(calls[0].url, 'https://test.supabase.co/rest/v1/rpc/caption_run_state');
  assert.equal(calls[0].options.headers.apikey, 'server-secret');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_run_id: 'run-1' });
});

test('verifyAdmin validates the JWT then evaluates database is_admin under that JWT', async () => {
  const calls = [];
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'user-1', email: 'admin@example.com' });
    return response(200, true);
  }});
  const user = await store.verifyAdmin('user-jwt');
  assert.equal(user.id, 'user-1');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-jwt');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer user-jwt');
  assert.match(calls[1].url, /\/rpc\/is_admin$/);
});

test('verifyAdmin denies an authenticated non-admin', async () => {
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', fetchImpl: async url => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'user-1' });
    return response(200, false);
  }});
  await assert.rejects(store.verifyAdmin('guest-jwt'), error => error instanceof CaptionStoreError && error.code === 'FORBIDDEN' && error.status === 403);
});

test('gateway persistence methods preserve the agreed RPC argument contract', async () => {
  const calls = [];
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return response(200, { ok: true });
  }});
  await store.checkpointDraft({ runId: 'r', modeGeneration: 3, fencingToken: 7, segment: { segmentId: 's' }, captions: [] });
  await store.persistFinalAndEnqueue({ runId: 'r', modeGeneration: 3, fencingToken: 7, sourceSegment: { segmentId: 's' }, captions: [], payloads: [], idempotencyKey: 'final:s' });
  assert.equal(calls[0].body.p_mode_generation, 3);
  assert.equal(calls[0].body.p_fencing_token, 7);
  assert.equal(calls[1].body.p_idempotency_key, 'final:s');
});

test('Postgres conflicts become sanitized 409 store errors', async () => {
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', fetchImpl: async () => response(400, { code: '40001', message: 'private database detail' }) });
  await assert.rejects(store.getRunState({ runId: 'run-1' }), error => {
    assert.equal(error.code, 'CONFLICT');
    assert.equal(error.status, 409);
    assert.equal(error.message, 'Caption request was rejected');
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test('getEventCurrentRun reads one event row with the service role and only ever sends a UUID', async () => {
  const calls = [], eventId = '11111111-1111-4111-8111-111111111111'; let rows = [{ current_run_id: 'run-1' }];
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(200, rows);
  }});
  assert.equal(await store.getEventCurrentRun({ eventId }), 'run-1');
  assert.equal(calls[0].url, `https://test.supabase.co/rest/v1/caption_events?id=eq.${eventId}&select=current_run_id`);
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-secret');
  rows = [{ current_run_id: null }]; assert.equal(await store.getEventCurrentRun({ eventId }), null);
  rows = []; assert.equal(await store.getEventCurrentRun({ eventId }), null);
  for (const bad of [undefined, 42, 'event-1', `${eventId}&select=*`, `${eventId},id.neq.x`]) {
    await assert.rejects(store.getEventCurrentRun({ eventId: bad }), error => error instanceof CaptionStoreError && error.code === 'INVALID_REQUEST' && error.status === 400);
  }
  assert.equal(calls.length, 3);
});

test('guest access and the guest snapshot are asked of the database as the service role, never as a guest', async () => {
  const calls = [];
  const store = new CaptionStore({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(200, url.endsWith('caption_guest_access') ? { event_id: 'e', run_id: null, expires_at: 'later' } : { eventId: 'e', updates: [] });
  }});
  assert.deepEqual(await store.guestAccess({ eventId: 'e', token: 'qr' }), { eventId: 'e', runId: null, expiresAt: 'later' });
  assert.deepEqual(await store.getSnapshotAsService({ eventId: 'e', runId: 'r', language: 'ja' }), { eventId: 'e', updates: [] });
  assert.deepEqual(calls.map(call => [call.url, call.options.headers.Authorization, JSON.parse(call.options.body)]), [
    ['https://test.supabase.co/rest/v1/rpc/caption_guest_access', 'Bearer server-secret', { p_event_id: 'e', p_token: 'qr' }],
    ['https://test.supabase.co/rest/v1/rpc/caption_snapshot', 'Bearer server-secret', { p_event_id: 'e', p_run_id: 'r', p_language: 'ja' }],
  ]);
  await assert.rejects(async () => store.guestAccess({ eventId: 'e' }), error => error.code === 'INVALID_REQUEST');
  await assert.rejects(async () => store.getSnapshotAsService({ eventId: 'e', language: 'ja' }), error => error.code === 'INVALID_REQUEST');
  assert.equal(calls.length, 2);
});

test('Supabase requests time out instead of hanging the caption pipeline', async () => {
  const store = new CaptionStore({
    supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-secret', requestTimeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  });
  await assert.rejects(store.health(), error => error.code === 'SUPABASE_UNAVAILABLE' && error.status === 503);
});
