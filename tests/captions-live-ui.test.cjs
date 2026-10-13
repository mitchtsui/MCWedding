'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Live = require('../live-captions-client.js');

test('caption API uses the pinned endpoint and bearer session without leaking server detail', async () => {
  let observed;
  const api = Live.create({ fetch: async (url, options) => {
    observed = { url, options, body: options.body ? JSON.parse(options.body) : undefined };
    return { ok: true, json: async () => ({ ok: true, requestId: 'r1', data: { enabled: false } }) };
  } });
  assert.deepEqual(await api.request('config', {}, 'session-token'), { enabled: false });
  assert.equal(observed.url, '/api/captions.js?action=config');
  assert.equal(observed.options.method, 'GET');
  assert.equal(observed.options.headers.Authorization, 'Bearer session-token');
  assert.equal(observed.options.body, undefined);

  const failed = Live.create({ fetch: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Safe\nmessage' } }) }) });
  await assert.rejects(failed.request('snapshot'), { message: 'Safe message', status: 400, code: 'INVALID_REQUEST' });
  const offline = Live.create({ fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.request('stop'), error => error.message === 'Caption service unavailable' && error.status === undefined,
    'a request that never reached the server carries no status, so the operator page cannot mistake it for a refusal');
});

test('store rejects stale revisions and reports message gaps without inventing updates', () => {
  const gaps = [], store = new Live.CaptionStore(gap => gaps.push(gap));
  const batch = (seq, text, revision = seq, epoch = '8f87ed59-8961-4964-bcd0-03c0f80818cc', id = 's1') => ({ eventId: 'e', runId: 'r', modeGeneration: 1, channelEpoch: epoch,
    messageSeq: seq, status: 'active', language: 'en', updates: [{ segmentId: 's1', segmentOrder: 1,
      sourceRevision: 1, captionRevision: revision, status: 'final', origin: 'provider', text, language: 'en', ...(id === 's1' ? {} : { segmentId: id, segmentOrder: 2 }) }] });
  assert.equal(store.merge(batch(4, 'first', 4)), true);
  assert.equal(store.merge(batch(3, 'stale', 3)), false);
  assert.equal(store.merge(batch(6, 'latest', 6)), true);
  assert.deepEqual(gaps, [{ reason: 'sequence_gap', expected: 5, received: 6 }]);
  assert.equal(store.segments('en')[0].text, 'latest');
  assert.equal(store.merge(batch(6, 'missing final', 1, '8f87ed59-8961-4964-bcd0-03c0f80818cc', 's2')), true, 'same-cursor snapshots merge missing finals');
  assert.equal(store.merge(batch(1, 'new epoch final', 1, 'ea641a9b-1747-439d-a122-9f56bbb29343', 's3')), true);
  assert.equal(store.segments('en').length, 3, 'epoch changes preserve existing final captions');
  assert.equal(gaps.at(-1).reason, 'epoch_changed');
  assert.equal(store.merge(batch(7, 'delayed old epoch', 7)), false, 'retired epochs cannot replace the current opaque epoch');
  const beforeHeartbeat = store.messageSeq;
  assert.equal(Live.heartbeatNeedsSnapshot(store, { modeGeneration: 1, channelEpoch: store.channelEpoch, messageSeq: beforeHeartbeat + 1 }), true);
  assert.equal(store.messageSeq, beforeHeartbeat, 'heartbeat watermarks never advance the applied-caption cursor');
  const gapStore = new Live.CaptionStore(gap => gaps.push(gap)); gapStore.merge(batch(1, 'one', 1));
  assert.equal(Live.heartbeatNeedsSnapshot(gapStore, { modeGeneration: 1, channelEpoch: gapStore.channelEpoch, messageSeq: 2 }), true);
  gapStore.merge(batch(3, 'three', 3));
  assert.deepEqual(gaps.at(-1), { reason: 'sequence_gap', expected: 2, received: 3 }, 'heartbeat cannot mask a missing caption batch');
  assert.deepEqual(store.segments('ja'), []);
});

test('manual corrections stay locked against higher-version AI and finals never regress to drafts', () => {
  const store = new Live.CaptionStore();
  const corrected = { segmentId: 's', segmentOrder: 0, language: 'en', sourceRevision: 3,
    captionRevision: 4, status: 'corrected', origin: 'manual', text: 'Reviewed words' };
  assert.equal(store.mergeUpdate(corrected), true);
  assert.equal(store.mergeUpdate({ ...corrected, sourceRevision: 4, captionRevision: 5,
    status: 'final', origin: 'ai_live', text: 'Late AI' }), false);
  assert.equal(store.mergeUpdate({ ...corrected, captionRevision: 5, text: 'New manual correction' }), true);
  assert.equal(store.segments('en')[0].text, 'New manual correction');
  const final = { ...corrected, segmentId: 's2', status: 'final', origin: 'ai_live' };
  assert.equal(store.mergeUpdate(final), true);
  assert.equal(store.mergeUpdate({ ...final, status: 'draft', sourceRevision: 99, captionRevision: 99 }), false);
});

test('new runs are followed only through an authorized current-run snapshot', async () => {
  const requested = [], scope = { eventId: 'e', runId: 'old', language: 'en' };
  const request = async (_action, value) => { requested.push(value.runId);
    return { ...value, currentRunId: 'new', updates: [] }; };
  const current = await Live.currentSnapshot(request, scope);
  assert.deepEqual(requested, ['old', 'new']); assert.equal(current.runId, 'new');
  await assert.rejects(Live.currentSnapshot(async (_action, value) => value.runId === 'old'
    ? { ...value, currentRunId: 'new' } : { ...value, eventId: 'other-event' }, scope), /synchronized/);
});

test('guest captions are accepted only when signed by the caption server', async () => {
  const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' }), other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' }), key = await Live.importGuestKey(jwk, webcrypto.subtle);
  const envelope = value => { const data = JSON.stringify(value); return { data, sig: sign('sha256', Buffer.from(data), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') }; };
  const good = envelope({ type: 'caption.batch', text: '多謝大家' });
  assert.deepEqual(await Live.openEnvelope(key, good, webcrypto.subtle), { type: 'caption.batch', text: '多謝大家' });
  assert.equal(await Live.openEnvelope(key, { ...good, data: good.data.replace('多謝', '屌') }, webcrypto.subtle), null, 'altered text is rejected');
  const forged = JSON.stringify({ type: 'caption.batch', text: 'fake' });
  assert.equal(await Live.openEnvelope(key, { data: forged, sig: sign('sha256', Buffer.from(forged), { key: other.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') }, webcrypto.subtle), null, 'another key is rejected');
  for (const bad of [null, { data: good.data }, { data: good.data, sig: 'short' }, { data: good.data, sig: '!'.repeat(86) }, { data: 42, sig: good.sig }]) assert.equal(await Live.openEnvelope(key, bad, webcrypto.subtle), null);
  await assert.rejects(Live.importGuestKey({ ...jwk, crv: 'P-384' }, webcrypto.subtle), /invalid/);
  let channelOptions; Live.subscribe({ channel: (_topic, options) => { channelOptions = options; return { on() { return this; }, subscribe() {} }; } }, 'caption-guest:e:en:abc', () => {}, () => {}, () => {}, { private: false });
  assert.deepEqual(channelOptions, { config: { private: false } });
  Live.subscribe({ channel: (_topic, options) => { channelOptions = options; return { on() { return this; }, subscribe() {} }; } }, 'caption:e:en', () => {});
  assert.deepEqual(channelOptions, { config: { private: true } }, 'operator channels stay private by default');
});

test('a genuine guest message is refused when replayed on another channel or long after it was signed', async () => {
  const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' }), key = await Live.importGuestKey(pair.publicKey.export({ format: 'jwk' }), webcrypto.subtle);
  const signed = (topic, iat, payload = { type: 'heartbeat' }) => { const data = JSON.stringify({ topic, iat, payload });
    return { data, sig: sign('sha256', Buffer.from(data), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') }; };
  const now = 1_800_000_000_000, options = { topic: 'caption-guest:e:en:aa', now, subtle: webcrypto.subtle };
  assert.deepEqual(await Live.openGuestMessage(key, signed('caption-guest:e:en:aa', now - 5000), options), { payload: { type: 'heartbeat' }, iat: now - 5000 });
  assert.equal(await Live.openGuestMessage(key, signed('caption-guest:e:ja:bb', now), options), null, 'signed for another channel');
  assert.equal(await Live.openGuestMessage(key, signed('caption-guest:e:en:aa', now - 121000), options), null, 'too old');
  assert.equal(await Live.openGuestMessage(key, signed('caption-guest:e:en:aa', now + 121000), options), null, 'from the future');
  assert.ok(await Live.openGuestMessage(key, signed('caption-guest:e:en:aa', now + 300000), { ...options, serverOffset: 300000 }), 'a phone whose clock is five minutes slow still accepts current messages');
  assert.equal(await Live.openGuestMessage(key, signed('caption-guest:e:en:aa', now, null), options), null, 'no payload');
});

test('guest invite helpers keep token in the fragment and clear it after redemption', () => {
  assert.equal(Live.fragmentToken('#event=e1&token=private-token'), 'private-token');
  assert.equal(Live.fragmentEventId('#event=e1&token=private-token'), 'e1');
  assert.equal(Live.fragmentRunId('#run=r1&token=private-token'), 'r1');
  let replacement = '';
  Live.clearFragment({ replaceState: (_a, _b, value) => { replacement = value; } }, { hash: '#token=x', pathname: '/live-captions.html', search: '?live=1' });
  assert.equal(replacement, '/live-captions.html?live=1');
  let options;
  Live.createSupabase({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public', supabase: {
    createClient: (_url, _key, value) => { options = value; return {}; }
  } }, 'guest-key', false);
  assert.equal(options.auth.detectSessionInUrl, false);
  assert.equal(options.auth.storageKey, 'guest-key');
  Live.createSupabase({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public', supabase: {
    createClient: (_url, _key, value) => { options = value; return {}; }
  } });
  assert.equal(Object.hasOwn(options.auth, 'storageKey'), false, 'admin reuses the existing default Supabase session');
});

test('live pages remain opt-in and use isolated auth plus text-only rendering', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'live-captions-admin.js'), 'utf8');
  const guest = fs.readFileSync(path.join(__dirname, '..', 'live-captions-guest.js'), 'utf8');
  assert.match(admin, /get\('live'\) === '1'/);
  assert.doesNotMatch(admin, /mc-captions-admin-auth/);
  assert.doesNotMatch(guest, /signInAnonymously|request\('redeem'|keepRealtimeAuth/, 'guests have no account of any kind');
  assert.match(guest, /api\.request\('guestSnapshot'/);
  assert.match(guest, /openGuestMessage\(guestKey, envelope, \{ topic: subscribedTopic, serverOffset \}\)/);
  assert.match(guest, /\{ private: false \}/);
  assert.match(guest, /clearFragment\(history, location\)/);
  assert.doesNotMatch(admin + guest, /\.innerHTML\s*=/);
  assert.match(admin, /type: 'auth', ticket: ticket\.token/);
  assert.match(admin, /captureEpoch: epoch, sequence, sampleOffset/);
  assert.match(admin, /drainStream\('end'\)/);
  assert.match(admin, /drainStream\('pause'\)/);
  assert.match(admin, /mode: 'live'/);
  assert.match(admin, /expiresAt: expiresAt\.toISOString\(\), maxUses/);
  assert.match(admin, /script = \{ title:.*content:.*sequence:.*active: true \}/);
});
