'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const crypto = require('node:crypto');
const { CaptionGateway, SupabaseBroadcastPublisher } = require('../lib/captions/gateway.cjs');
const { createGuestSigner } = require('../lib/captions/guest-link.cjs');
const captionsStreamServer = require('../api/captions-stream.js');
const { FRAME_BYTES } = require('../lib/captions/protocol.cjs');

const waitFor = async (predicate, timeout = 1500) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

class FakeClientSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code, reason) { this.readyState = 3; this.closedWith = { code, reason }; this.emit('close', code, reason); }
}

class FakeAsr {
  async open(onEvent) { this.onEvent = onEvent; }
  append() {}
  commit(order) {
    queueMicrotask(() => {
      this.onEvent({ type: 'committed', itemId: `item-${order}`, segmentOrder: order });
      this.onEvent({ type: 'completed', itemId: `item-${order}`, segmentOrder: order, transcript: '多謝大家今日嚟到' });
    });
  }
  clear() {}
  async drain() {}
  close() { this.closed = true; }
}

function fakeStore(activity) {
  let seq = 0;
  const outbox = [];
  return {
    state: { state: 'live', modeGeneration: 1, fencingToken: 9, messageSeq: 0,
      scriptCues: [{ id: 1, text: '多謝大家今日嚟到' }], glossary: [] },
    async consumeUplinkTicket() { return { eventId: 'event-1', runId: 'run-1', userId: 'operator',
      modeGeneration: 1, fencingToken: 9, channelEpoch: 'epoch-1' }; },
    async getRunState() { return this.state; },
    async recoverPending() { return { drafts: [], outbox: [] }; },
    async reserveMessageSequenceBlock() { return { channelEpoch: 'epoch-1', ranges: {
      en: { start: 1, end: 128 }, ja: { start: 1, end: 128 }, 'zh-CN': { start: 1, end: 128 },
    } }; },
    async reserveSegmentOrder() { return { segmentOrder: 0, segmentId: '00000000-0000-4000-8000-000000000001' }; },
    async checkpointSource() {},
    async checkpointDraft() { seq += 1; return { messageSeq: seq }; },
    async persistFinalAndEnqueue(input) {
      activity.push(`persist:${input.captions[0].language}`);
      seq += 1;
      for (const item of input.payloads) outbox.push({ outboxId: `outbox-${seq}-${item.language}`,
        language: item.language, payload: { ...item.payload, messageSeq: seq } });
      return { messageSeq: seq };
    },
    async claimOutbox() { return outbox.splice(0); },
    async completeOutbox({ outboxId, error }) { activity.push(`${error ? 'fail' : 'complete'}:${outboxId}`); },
    async recordOperationalEvent() {},
    async recordScriptReview() { return { reviewId: 'review-1' }; },
    async renewPublisherLease() {},
  };
}

test('gateway authenticates once, translates final source in independent lanes, persists before publish, and emits review only', async () => {
  const activity = [];
  const store = fakeStore(activity);
  const publisher = { async publish(topic, event, payload) { activity.push(`publish:${payload.language}`); } };
  const gateway = new CaptionGateway({ store, publisher, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => new FakeAsr(), translator: { async translate({ language, currentSegment }) {
      assert.equal(currentSegment, '多謝大家今日嚟到'); return { text: `${language}-translation` };
    } }, scriptAssistant: { async review() { return { decision: 'suggest', suggestedText: '多謝大家今日來到',
      matchedCueIds: [1], explanation: 'candidate', reviewable: true, rejectionReason: null, effectiveText: '多謝大家今日嚟到' }; } },
    config: { commitMode: 'fixed', fixedCommitMs: 50, heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 },
    idFactory: () => '00000000-0000-4000-8000-000000000001' });
  const socket = new FakeClientSocket();
  const session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => socket.sent.some(message => message.type === 'ready'));
  const audio = Buffer.alloc(FRAME_BYTES);
  for (let offset = 0; offset < audio.length; offset += 2) audio.writeInt16LE(4000, offset);
  socket.emit('message', JSON.stringify({ type: 'audio', captureEpoch: 'capture', sequence: 0,
    sampleOffset: 0, audio: audio.toString('base64') }));
  await waitFor(() => activity.filter(item => item.startsWith('publish:')).length === 3);
  assert.deepEqual(new Set(activity.filter(item => item.startsWith('persist:')).map(item => item.slice(8))), new Set(['en', 'ja', 'zh-CN']));
  for (const language of ['en', 'ja', 'zh-CN']) {
    assert(activity.indexOf(`persist:${language}`) < activity.indexOf(`publish:${language}`), `${language} published before persistence`);
  }
  assert(socket.sent.some(message => message.type === 'source' && message.status === 'final'));
  const review = socket.sent.find(message => message.type === 'review');
  assert.equal(review.rawText, '多謝大家今日嚟到');
  assert.equal(review.proposedText, '多謝大家今日來到');
  const batches = socket.sent.filter(message => message.type === 'caption.batch');
  assert.equal(batches.length, 3);
  assert(batches.every(batch => batch.updates[0].text.endsWith('-translation')));
  session.stop('test_complete');
});

test('stale generation prevents an in-flight translation from publishing', async () => {
  const activity = [];
  const store = fakeStore(activity);
  let release;
  const translator = { translate: () => new Promise(resolve => { release = resolve; }) };
  const gateway = new CaptionGateway({ store, publisher: { async publish() { activity.push('published'); } },
    allowedOrigins: ['https://wedding.example'], asrFactory: () => new FakeAsr(), translator,
    config: { commitMode: 'fixed', fixedCommitMs: 50, heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 },
    idFactory: () => '00000000-0000-4000-8000-000000000002' });
  const socket = new FakeClientSocket();
  const session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => socket.sent.some(message => message.type === 'ready'));
  const audio = Buffer.alloc(FRAME_BYTES);
  for (let offset = 0; offset < audio.length; offset += 2) audio.writeInt16LE(4000, offset);
  socket.emit('message', JSON.stringify({ type: 'audio', captureEpoch: 'capture', sequence: 0,
    sampleOffset: 0, audio: audio.toString('base64') }));
  await waitFor(() => typeof release === 'function');
  store.state = { ...store.state, modeGeneration: 2 };
  release({ text: 'late' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(activity.some(item => item.startsWith('persist:') || item === 'published'), false);
  session.stop('test_complete');
});

test('draft broadcasts from a fenced sequence block before its best-effort checkpoint', async () => {
  const activity = [];
  const store = fakeStore(activity);
  store.checkpointDraft = async input => { activity.push(`checkpoint:${input.captions[0].messageSeq}`); return {}; };
  const gateway = new CaptionGateway({ store, publisher: { async publish(topic, event, payload) { activity.push(`publish:${payload.messageSeq}`); } },
    allowedOrigins: ['https://wedding.example'], asrFactory: () => new FakeAsr(),
    translator: { async translate() { return { text: 'draft translation' }; } },
    config: { heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket();
  const session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => socket.sent.some(message => message.type === 'ready'));
  await session.translate('en', { source: { itemId: 'item', segmentId: '00000000-0000-4000-8000-000000000007',
    segmentOrder: 7, sourceRevision: 1, text: '原文' }, status: 'draft', context: [], modeGeneration: 1, fencingToken: 9 });
  await waitFor(() => activity.some(item => item.startsWith('checkpoint:')));
  assert.deepEqual(activity.filter(item => /^(publish|checkpoint):/.test(item)), ['publish:1', 'checkpoint:1']);
  session.stop('test_complete');
});

test('accepted script review creates a higher source revision and retranslates all languages before completion', async () => {
  const activity = [];
  const store = fakeStore(activity);
  let claimed = false;
  store.claimApprovedReviews = async () => claimed ? [] : (claimed = true, [{ reviewId: 'review-accepted',
    segmentId: '00000000-0000-4000-8000-000000000009', segmentOrder: 4, sourceRevision: 2,
    originalText: '舊文字', proposedText: '更正文字', providerItemId: 'provider-item' }]);
  store.completeApprovedReview = async ({ reviewId, error }) => activity.push(`review:${reviewId}:${error ? 'failed' : 'complete'}`);
  const gateway = new CaptionGateway({ store, publisher: { async publish(topic, event, payload) { activity.push(`publish:${payload.language}`); } },
    allowedOrigins: ['https://wedding.example'], asrFactory: () => new FakeAsr(),
    translator: { async translate({ language, currentSegment }) { assert.equal(currentSegment, '更正文字'); return { text: `${language}-corrected` }; } },
    config: { heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket();
  const session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => socket.sent.some(message => message.type === 'ready'));
  await session.pollApprovedReviews();
  await waitFor(() => activity.includes('review:review-accepted:complete'));
  assert.equal(activity.filter(item => item.startsWith('persist:')).length, 3);
  assert(socket.sent.some(message => message.type === 'source' && message.status === 'corrected' && message.sourceRevision === 3));
  session.stop('test_complete');
});

test('normal end drains the buffered speech tail before acknowledging', async () => {
  const activity = [];
  const store = fakeStore(activity);
  const gateway = new CaptionGateway({ store, publisher: { async publish(topic, event, payload) { activity.push(`publish:${payload.language}`); } },
    allowedOrigins: ['https://wedding.example'], asrFactory: () => new FakeAsr(),
    translator: { async translate({ language }) { return { text: `${language}-tail` }; } },
    config: { heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket();
  const session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => socket.sent.some(message => message.type === 'ready'));
  const audio = Buffer.alloc(FRAME_BYTES);
  for (let offset = 0; offset < audio.length; offset += 2) audio.writeInt16LE(4000, offset);
  socket.emit('message', JSON.stringify({ type: 'audio', captureEpoch: 'capture', sequence: 0,
    sampleOffset: 0, audio: audio.toString('base64') }));
  socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' }));
  await waitFor(() => socket.sent.some(message => message.type === 'status' && message.status === 'drained'));
  const drainedIndex = socket.sent.findIndex(message => message.type === 'status' && message.status === 'drained');
  assert.equal(activity.filter(item => item.startsWith('publish:')).length, 3);
  assert(socket.sent.slice(0, drainedIndex).filter(message => message.type === 'caption.batch').length === 3);
  session.stop('test_complete');
});

test('closing during authentication never opens an orphan ASR provider', async () => {
  let releaseTicket, providerOpened = 0;
  const store = fakeStore([]);
  store.consumeUplinkTicket = () => new Promise(resolve => { releaseTicket = resolve; });
  const gateway = new CaptionGateway({ store, publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => ({ async open() { providerOpened += 1; }, close() {} }), translator: { async translate() { return { text: '' }; } },
    config: { heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => typeof releaseTicket === 'function'); socket.close(1000, 'gone');
  releaseTicket({ eventId: 'event-1', runId: 'run-1', modeGeneration: 1, fencingToken: 9, channelEpoch: 'epoch-1' });
  await session.processing;
  assert.equal(session.closed, true); assert.equal(session.authenticated, false); assert.equal(providerOpened, 0); assert.equal(session.heartbeatTimer, undefined);
});

test('closing while ASR opens closes the late provider and creates no timers', async () => {
  let releaseOpen, providerOpened = 0, providerClosed = 0;
  const asr = { open() { providerOpened += 1; return new Promise(resolve => { releaseOpen = resolve; }); }, close() { providerClosed += 1; } };
  const gateway = new CaptionGateway({ store: fakeStore([]), publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => asr, translator: { async translate() { return { text: '' }; } },
    config: { heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' }));
  await waitFor(() => providerOpened === 1); socket.close(1000, 'gone'); releaseOpen(); await session.processing;
  assert.equal(session.authenticated, false); assert(providerClosed >= 2, 'provider is closed both at disconnect and after late open completion');
  assert.equal(session.heartbeatTimer, undefined);
});

test('stop persists unavailable gaps for committed and reserved unfinished turns', async () => {
  for (const emitsCommitted of [true, false]) {
    const activity = [], operational = [], store = fakeStore(activity);
    store.recordOperationalEvent = async value => { operational.push(value); };
    const asr = { async open(onEvent) { this.onEvent = onEvent; }, append() {}, commit(order) {
      if (emitsCommitted) queueMicrotask(() => this.onEvent({ type: 'committed', itemId: `pending-${order}`, segmentOrder: order }));
    }, clear() {}, async drain() {}, close() {} };
    const gateway = new CaptionGateway({ store, publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
      asrFactory: () => asr, translator: { async translate() { return { text: '' }; } },
      config: { commitMode: 'fixed', fixedCommitMs: 50, heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
    const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
    socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => socket.sent.some(value => value.type === 'ready'));
    const audio = Buffer.alloc(FRAME_BYTES, 16); socket.emit('message', JSON.stringify({ type: 'audio', captureEpoch: 'capture', sequence: 0, sampleOffset: 0, audio: audio.toString('base64') }));
    await waitFor(() => emitsCommitted ? session.sourceByItem.size === 1 : session.reservedSegments.size === 1);
    session.stop('client_disconnected'); await session.stopPromise;
    assert.equal(activity.filter(value => value === 'persist:en').length, 1);
    assert(operational.some(value => value.type === 'asr_gap' && value.detailsSafe.code === 'connection_closed_before_asr_final'));
  }
});

test('close while segment reservation is pending persists the late reservation as unavailable', async () => {
  const activity = [], store = fakeStore(activity); let releaseReservation;
  store.reserveSegmentOrder = () => new Promise(resolve => { releaseReservation = resolve; });
  const gateway = new CaptionGateway({ store, publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => new FakeAsr(), translator: { async translate() { return { text: '' }; } },
    config: { commitMode: 'fixed', fixedCommitMs: 50, heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => socket.sent.some(value => value.type === 'ready'));
  const audio = Buffer.alloc(FRAME_BYTES, 16); socket.emit('message', JSON.stringify({ type: 'audio', captureEpoch: 'capture', sequence: 0, sampleOffset: 0, audio: audio.toString('base64') }));
  await waitFor(() => typeof releaseReservation === 'function'); session.stop('client_disconnected');
  releaseReservation({ segmentOrder: 0, segmentId: '00000000-0000-4000-8000-000000000099' }); await session.processing;
  assert.equal(activity.filter(value => value === 'persist:en').length, 1);
});

test('heartbeat provider failures are contained and recorded', async () => {
  const operational = [], store = fakeStore([]); store.recordOperationalEvent = async value => { operational.push(value); };
  const gateway = new CaptionGateway({ store, publisher: { async publish(_topic, event) { if (event === 'heartbeat') throw Object.assign(new Error('down'), { code: 'broadcast_failed' }); } },
    allowedOrigins: ['https://wedding.example'], asrFactory: () => new FakeAsr(), translator: { async translate() { return { text: '' }; } },
    config: { heartbeatMs: 100000, backgroundTaskTimeoutMs: 100, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => socket.sent.some(value => value.type === 'ready'));
  await session.runHeartbeat();
  assert(socket.sent.some(value => value.type === 'status' && value.status === 'broadcast.degraded'));
  assert(operational.some(value => value.type === 'heartbeat_failed'));
  session.stop('test_complete');
});

test('end drain reports unresolved broadcast failures as an explicit gap', async () => {
  const activity = [], operational = [], store = fakeStore(activity); let expose = false;
  store.recordOperationalEvent = async value => { operational.push(value); };
  store.claimOutbox = async () => expose ? (expose = false, [{ outboxId: 'failed-outbox', language: 'en', payload: {
    modeGeneration: 1, channelEpoch: 'epoch-1', messageSeq: 1, language: 'en', updates: [] } }]) : [];
  const gateway = new CaptionGateway({ store, publisher: { async publish() { throw new Error('broadcast down'); } },
    allowedOrigins: ['https://wedding.example'], asrFactory: () => new FakeAsr(), translator: { async translate() { return { text: '' }; } },
    config: { heartbeatMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => socket.sent.some(value => value.type === 'ready'));
  expose = true; const failed = await session.flushOutbox(); assert.equal(failed.failed, 1);
  socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' })); await waitFor(() => socket.sent.some(value => value.status === 'drained'));
  const drained = socket.sent.find(value => value.status === 'drained'); assert.equal(drained.withGap, true); assert.equal(drained.delivery.unresolvedFailed, 1);
  assert(operational.some(value => value.detailsSafe?.reason === 'end_delivery_failed'));
  session.stop('test_complete');
});

// Mirrors the commit/drain bookkeeping of OpenAIRealtimeAsr; the test decides when the provider answers.
class ControlledAsr {
  constructor() { this.committedTurns = 0; this.terminalTurns = 0; this.orders = []; this.closed = 0; }
  async open(onEvent) { this.onEvent = onEvent; }
  append() {}
  commit(order) { this.orders.push(order); this.committedTurns += 1; }
  clear() {}
  async drain(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (this.terminalTurns < this.committedTurns) {
      if (Date.now() >= deadline) throw Object.assign(new Error('ASR drain timed out'), { code: 'asr_drain_timeout' });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  committed(order) { this.onEvent({ type: 'committed', itemId: `item-${order}`, segmentOrder: order }); }
  complete(order) {
    this.committed(order); this.terminalTurns += 1;
    this.onEvent({ type: 'completed', itemId: `item-${order}`, segmentOrder: order, transcript: '多謝大家今日嚟到' });
  }
  close() { this.closed += 1; }
}

const loudFrame = sequence => {
  const audio = Buffer.alloc(FRAME_BYTES);
  for (let offset = 0; offset < audio.length; offset += 2) audio.writeInt16LE(4000, offset);
  return JSON.stringify({ type: 'audio', captureEpoch: 'capture', sequence, sampleOffset: sequence * 1200, audio: audio.toString('base64') });
};

function sequentialStore(activity, operational) {
  const store = fakeStore(activity); let order = 0;
  store.reserveSegmentOrder = async () => { const value = order++; return { segmentOrder: value, segmentId: `00000000-0000-4000-8000-00000000010${value}` }; };
  store.recordOperationalEvent = async value => { operational.push(value); };
  return store;
}

async function openSession({ store, asr, translator, config = {} }) {
  const gateway = new CaptionGateway({ store, publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => asr, translator: translator ?? { async translate({ language }) { return { text: `${language}-translation` }; } },
    config: { heartbeatMs: 100000, leaseRenewMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000, ...config } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => socket.sent.some(value => value.type === 'ready'));
  return { socket, session };
}

test('ASR session failure ends the connection with a retryable error and durable gap evidence', async () => {
  const activity = [], operational = [], store = sequentialStore(activity, operational), asr = new ControlledAsr();
  const { socket, session } = await openSession({ store, asr, config: { commitMode: 'fixed', fixedCommitMs: 100 } });
  socket.emit('message', loudFrame(0)); socket.emit('message', loudFrame(1));
  await waitFor(() => asr.committedTurns === 1); asr.committed(0);
  asr.onEvent({ type: 'failed', itemId: 'item-0', segmentOrder: 0, code: 'provider_transcription_failed' });
  await waitFor(() => operational.some(value => value.type === 'asr_gap' && value.detailsSafe.code === 'provider_transcription_failed'));
  assert.equal(session.closed, false, 'a single failed item keeps the connection');
  socket.emit('message', loudFrame(2)); socket.emit('message', loudFrame(3));
  await waitFor(() => asr.committedTurns === 2); asr.committed(1);
  socket.emit('message', loudFrame(4)); await session.processing;
  asr.onEvent({ type: 'failed', code: 'asr_connection', closeCode: 1006 });
  await waitFor(() => socket.closedWith); await session.stopPromise;
  assert.equal(socket.closedWith.code, 1011); assert.equal(session.closed, true);
  const errors = socket.sent.filter(value => value.type === 'error');
  assert.deepEqual(errors.map(value => [value.code, value.retryable]), [['asr_unavailable', true]]);
  assert(operational.some(value => value.type === 'asr_gap' && value.detailsSafe.code === 'asr_connection'));
  assert(operational.some(value => value.type === 'stream_gap' && value.detailsSafe.reason === 'unconfirmed_audio_on_close'));
  assert(operational.some(value => value.type === 'asr_gap' && value.detailsSafe.segmentOrder === 1 &&
    value.detailsSafe.code === 'connection_closed_before_asr_final'));
});

test('an ASR send failure closes the connection instead of failing once per frame', async () => {
  const asr = new ControlledAsr(); asr.append = () => { throw Object.assign(new Error('ASR is unavailable'), { code: 'asr_unavailable' }); };
  const { socket, session } = await openSession({ store: sequentialStore([], []), asr });
  for (let sequence = 0; sequence < 5; sequence += 1) socket.emit('message', loudFrame(sequence));
  await waitFor(() => socket.closedWith); await session.processing;
  assert.equal(socket.closedWith.code, 1011);
  assert.deepEqual(socket.sent.filter(value => value.type === 'error').map(value => [value.code, value.retryable]), [['asr_unavailable', true]]);
});

test('end reports finals that were not saved or not translated instead of a clean finish', async () => {
  const unavailable = () => { throw Object.assign(new Error('Caption storage is unavailable'), { code: 'SUPABASE_UNAVAILABLE' }); };
  for (const scenario of ['translation_failed', 'storage_down', 'checkpoint_recovered', 'clean']) {
    const activity = [], operational = [], store = sequentialStore(activity, operational); let checkpoints = 0;
    if (scenario === 'checkpoint_recovered') store.checkpointSource = async () => { checkpoints += 1; unavailable(); };
    if (scenario === 'storage_down') {
      store.checkpointSource = async () => { checkpoints += 1; unavailable(); };
      store.persistFinalAndEnqueue = async () => unavailable();
    }
    const translator = { async translate({ language }) {
      if (scenario === 'translation_failed' && language === 'ja') throw Object.assign(new Error('provider 500'), { code: 'translation_failed' });
      return { text: `${language}-translation` };
    } };
    const { socket, session } = await openSession({ store, asr: new FakeAsr(), translator, config: { commitMode: 'fixed', fixedCommitMs: 50 } });
    socket.emit('message', loudFrame(0)); await waitFor(() => socket.sent.some(value => value.type === 'source' && value.status === 'final'));
    socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' })); await waitFor(() => socket.sent.some(value => value.status === 'drained'));
    const drained = socket.sent.find(value => value.status === 'drained');
    const expected = { clean: { captions: 0, sources: 0 }, translation_failed: { captions: 1, sources: 0 },
      checkpoint_recovered: { captions: 0, sources: 0 }, storage_down: { captions: 3, sources: 1 } }[scenario];
    const withGap = expected.captions + expected.sources > 0;
    assert.equal(drained.withGap, withGap, scenario); assert.deepEqual(drained.failures, expected, scenario);
    assert.equal(socket.sent.some(value => value.status === 'stream.gap' && value.reason === 'end_caption_failures'), withGap, scenario);
    assert.deepEqual(operational.filter(value => value.detailsSafe?.reason === 'end_caption_failures').map(value => value.detailsSafe),
      withGap ? [{ reason: 'end_caption_failures', ...expected }] : [], scenario);
    session.stop('test_complete'); await session.stopPromise;
    const lost = operational.filter(value => value.type === 'asr_gap' && value.detailsSafe.reason === 'source_checkpoint_lost');
    if (scenario === 'storage_down') {
      assert.equal(checkpoints, 2, 'stop retries the lost source checkpoint once');
      assert.deepEqual(lost.map(value => [value.detailsSafe.segmentOrder, value.detailsSafe.closeReason]), [[0, 'test_complete']]);
    } else assert.equal(lost.length, 0, scenario);
    if (scenario === 'checkpoint_recovered') assert.equal(checkpoints, 1, 'a source saved with its captions needs no retry');
  }
});

test('end counts a final whose failure handling could not read the run state', async () => {
  const activity = [], store = sequentialStore(activity, []), asr = new ControlledAsr(); let stateDown = false;
  const getRunState = store.getRunState.bind(store);
  store.getRunState = async () => { if (stateDown) throw Object.assign(new Error('Caption storage is unavailable'), { code: 'SUPABASE_UNAVAILABLE' }); return getRunState(); };
  const { socket, session } = await openSession({ store, asr, config: { commitMode: 'fixed', fixedCommitMs: 50 } });
  socket.emit('message', loudFrame(0)); await waitFor(() => asr.committedTurns === 1);
  stateDown = true; asr.complete(0);
  await waitFor(() => socket.sent.filter(value => value.status === 'database.degraded').length === 3); stateDown = false;
  socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' })); await waitFor(() => socket.sent.some(value => value.status === 'drained'));
  const drained = socket.sent.find(value => value.status === 'drained');
  assert.equal(activity.filter(value => value.startsWith('persist:')).length, 0);
  assert.equal(drained.withGap, true); assert.deepEqual(drained.failures, { captions: 3, sources: 0 });
  session.stop('test_complete');
});

test('a failed final caption that a later correction delivers is not reported at end', async () => {
  const activity = [], store = sequentialStore(activity, []); let failJa = true, claimed = false;
  store.claimApprovedReviews = async () => claimed ? [] : (claimed = true, [{ reviewId: 'review-accepted',
    segmentId: '00000000-0000-4000-8000-000000000100', segmentOrder: 0, sourceRevision: 1, proposedText: '更正文字' }]);
  store.completeApprovedReview = async ({ error }) => { activity.push(`review:${error ? 'failed' : 'complete'}`); };
  const translator = { async translate({ language }) {
    if (language === 'ja' && failJa) { failJa = false; throw Object.assign(new Error('provider 500'), { code: 'translation_failed' }); }
    return { text: `${language}-translation` };
  } };
  const { socket, session } = await openSession({ store, asr: new FakeAsr(), translator, config: { commitMode: 'fixed', fixedCommitMs: 50 } });
  socket.emit('message', loudFrame(0)); await waitFor(() => session.finalFailures.size === 1);
  await session.pollApprovedReviews(); await waitFor(() => activity.includes('review:complete'));
  socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' })); await waitFor(() => socket.sent.some(value => value.status === 'drained'));
  const drained = socket.sent.find(value => value.status === 'drained');
  assert.deepEqual(drained.failures, { captions: 0, sources: 0 }); assert.equal(drained.withGap, false);
  session.stop('test_complete');
});

test('end waits for in-flight translation failure handling before acknowledging', async () => {
  const store = sequentialStore([], []), persist = store.persistFinalAndEnqueue.bind(store);
  store.persistFinalAndEnqueue = async input => {
    if (input.captions[0].status === 'unavailable') await new Promise(resolve => setTimeout(resolve, 60));
    return persist(input);
  };
  const translator = { async translate({ language }) {
    if (language === 'ja') throw Object.assign(new Error('provider 500'), { code: 'translation_failed' });
    return { text: `${language}-translation` };
  } };
  const { socket, session } = await openSession({ store, asr: new FakeAsr(), translator, config: { commitMode: 'fixed', fixedCommitMs: 50 } });
  socket.emit('message', loudFrame(0)); await waitFor(() => socket.sent.some(value => value.type === 'source' && value.status === 'final'));
  socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' })); await waitFor(() => socket.sent.some(value => value.status === 'drained'));
  const drainedIndex = socket.sent.findIndex(value => value.status === 'drained');
  assert(socket.sent.slice(0, drainedIndex).some(value => value.type === 'caption.batch' && value.language === 'ja' &&
    value.updates[0].status === 'unavailable'), 'the unavailable caption is persisted and delivered before drained');
  assert.deepEqual(socket.sent[drainedIndex].failures, { captions: 1, sources: 0 });
  session.stop('test_complete');
});

test('rotation lets a turn whose reservation is in flight reach its source checkpoint before rotate', async () => {
  const store = sequentialStore([], []), asr = new ControlledAsr(), checkpointedAfterRotate = []; let release;
  const reserve = store.reserveSegmentOrder; store.reserveSegmentOrder = () => new Promise(resolve => { release = () => reserve().then(resolve); });
  const { socket, session } = await openSession({ store, asr, config: { commitMode: 'fixed', fixedCommitMs: 50 } });
  store.checkpointSource = async () => { checkpointedAfterRotate.push(socket.sent.some(value => value.type === 'rotate')); };
  socket.emit('message', loudFrame(0)); await waitFor(() => typeof release === 'function');
  const rotating = session.prepareRotation();
  await new Promise(resolve => setTimeout(resolve, 20)); release();
  await waitFor(() => asr.committedTurns === 1); await new Promise(resolve => setTimeout(resolve, 20));
  asr.complete(0); await rotating;
  assert.deepEqual(checkpointedAfterRotate, [false]);
  assert.equal(socket.sent.some(value => value.status === 'stream.gap'), false);
  assert(socket.sent.some(value => value.type === 'rotate'));
  session.stop('test_complete');
});

test('end arriving while rotation reserves the tail commits that tail once and drains without a gap', async () => {
  const activity = [], store = sequentialStore(activity, []), asr = new ControlledAsr(), releases = [];
  const { socket, session } = await openSession({ store, asr });
  for (let sequence = 0; sequence < 5; sequence += 1) socket.emit('message', loudFrame(sequence));
  await session.processing;
  const reserve = store.reserveSegmentOrder; store.reserveSegmentOrder = () => new Promise(resolve => releases.push(() => reserve().then(resolve)));
  const rotating = session.prepareRotation(); await waitFor(() => releases.length === 1);
  socket.emit('message', JSON.stringify({ type: 'drain', reason: 'end' })); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(releases.length, 1, 'one spoken tail reserves one segment');
  assert.equal(socket.sent.some(value => value.status === 'drained'), false, 'not drained while the tail is unreserved');
  releases.forEach(release => release()); await waitFor(() => asr.committedTurns === 1);
  asr.complete(0); await waitFor(() => socket.sent.some(value => value.status === 'drained')); await rotating;
  assert.deepEqual(asr.orders, [0]);
  const drained = socket.sent.find(value => value.status === 'drained');
  assert.equal(drained.withGap, false); assert.equal(socket.sent.some(value => value.status === 'stream.gap'), false);
  assert.deepEqual(activity.filter(value => value.startsWith('persist:')).sort(), ['persist:en', 'persist:ja', 'persist:zh-CN']);
  session.stop('test_complete');
});

test('the hard shutdown timer closes the operator socket', async () => {
  const { socket, session } = await openSession({ store: sequentialStore([], []), asr: new ControlledAsr(), config: { shutdownAfterMs: 60 } });
  await waitFor(() => socket.closedWith);
  assert.equal(socket.closedWith.code, 1001); assert.equal(session.closed, true);
});

test('a run stopped while ASR opens is rejected before ready', async () => {
  const store = sequentialStore([], []), asr = new ControlledAsr(); let release;
  const open = asr.open.bind(asr); asr.open = onEvent => new Promise(resolve => { release = () => open(onEvent).then(resolve); });
  const gateway = new CaptionGateway({ store, publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => asr, translator: { async translate() { return { text: '' }; } },
    config: { heartbeatMs: 100000, leaseRenewMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => typeof release === 'function');
  store.state = { ...store.state, state: 'stopped', modeGeneration: 2 };
  release(); await waitFor(() => socket.closedWith);
  assert.equal(socket.closedWith.code, 1008);
  assert.equal(socket.sent.some(value => value.type === 'ready'), false);
  assert.deepEqual(socket.sent.filter(value => value.type === 'error').map(value => value.code), ['stale_ticket']);
  assert(asr.closed >= 1); assert.equal(session.heartbeatTimer, undefined); assert.equal(session.rotateTimer, undefined);
});

test('a failure after ASR opens during authentication closes the connection and the provider', async () => {
  const store = sequentialStore([], []), asr = new ControlledAsr();
  store.recoverPending = async () => { throw Object.assign(new Error('Caption storage is unavailable'), { code: 'SUPABASE_UNAVAILABLE' }); };
  const gateway = new CaptionGateway({ store, publisher: { async publish() {} }, allowedOrigins: ['https://wedding.example'],
    asrFactory: () => asr, translator: { async translate() { return { text: '' }; } },
    config: { heartbeatMs: 100000, leaseRenewMs: 100000, rotateAfterMs: 100000, shutdownAfterMs: 110000 } });
  const socket = new FakeClientSocket(), session = gateway.attach(socket, { origin: 'https://wedding.example' });
  socket.emit('message', JSON.stringify({ type: 'auth', ticket: 'ticket' })); await waitFor(() => socket.closedWith);
  assert.equal(socket.closedWith.code, 1011); assert.equal(session.closed, true);
  assert.equal(socket.sent.some(value => value.type === 'ready'), false);
  assert.deepEqual(socket.sent.filter(value => value.type === 'error').map(value => value.code), ['SUPABASE_UNAVAILABLE']);
  assert(asr.closed >= 1, 'the opened provider is closed');
  for (const timer of ['authTimer', 'heartbeatTimer', 'leaseTimer', 'rotateTimer', 'shutdownTimer']) {
    assert(session[timer] === undefined || session[timer]._destroyed, `${timer} is not left running`);
  }
});

test('the broadcast publisher sends a signed public guest copy in the same request, and that request failing fails the publish', async () => {
  const signer = createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') });
  const requests = []; let status = 202;
  const publisher = new SupabaseBroadcastPublisher({ supabaseUrl: 'https://test.supabase.co/', serviceRoleKey: 'secret', guestSigner: signer,
    fetchImpl: async (url, options) => { requests.push({ url, messages: JSON.parse(options.body).messages }); return { ok: status < 300, status }; } });
  const eventId = '11111111-1111-4111-8111-111111111111';
  for (const [event, payload] of [['caption.batch', { type: 'caption.batch', eventId, language: 'zh-CN', messageSeq: 7, updates: [] }],
    ['heartbeat', { type: 'heartbeat', eventId, language: 'zh-CN', messageSeq: 7, status: 'live' }]]) {
    await publisher.publish(`caption:${eventId}:zh-CN`, event, payload);
    const { url, messages } = requests.at(-1);
    assert.equal(url, 'https://test.supabase.co/realtime/v1/api/broadcast');
    assert.deepEqual(messages[0], { topic: `caption:${eventId}:zh-CN`, event, payload, private: true });
    assert.deepEqual({ ...messages[1], payload: undefined }, { topic: signer.topicFor(eventId, 'zh-CN'), event, payload: undefined, private: false });
    assert.deepEqual(JSON.parse(messages[1].payload.data), payload);
    const key = await crypto.webcrypto.subtle.importKey('jwk', signer.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.equal(await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
      Buffer.from(messages[1].payload.sig, 'base64url'), new TextEncoder().encode(messages[1].payload.data)), true);
  }
  status = 500;
  await assert.rejects(publisher.publish(`caption:${eventId}:en`, 'caption.batch', { type: 'caption.batch' }), error => error.code === 'broadcast_failed');
  assert.equal(requests.at(-1).messages.length, 2);
});

test('without a guest signing key the publisher sends only the private message, as before', async () => {
  const saved = process.env.CAPTIONS_GUEST_SIGNING_KEY, requests = [];
  const fetchImpl = async (url, options) => { requests.push(JSON.parse(options.body).messages); return { ok: true, status: 202 }; };
  try {
    delete process.env.CAPTIONS_GUEST_SIGNING_KEY;
    for (const publisher of [new SupabaseBroadcastPublisher({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'secret', fetchImpl }),
      new SupabaseBroadcastPublisher({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'secret', fetchImpl, guestSigner: null })]) {
      await publisher.publish('caption:event-1:en', 'heartbeat', { type: 'heartbeat' });
      assert.deepEqual(requests.at(-1), [{ topic: 'caption:event-1:en', event: 'heartbeat', payload: { type: 'heartbeat' }, private: true }]);
    }
    // The signer is passed explicitly: a key in the process environment alone does not make a publisher sign.
    const signingKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    process.env.CAPTIONS_GUEST_SIGNING_KEY = signingKey;
    await new SupabaseBroadcastPublisher({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'secret', fetchImpl })
      .publish('caption:event-1:en', 'heartbeat', { type: 'heartbeat' });
    assert.deepEqual(requests.at(-1).map(message => message.private), [true]);
    // The deployed stream server wires the signer from its own environment.
    const runtime = env => captionsStreamServer.createRuntimeFromEnv({ CAPTIONS_ENABLED: 'true', CAPTIONS_ALLOWED_ORIGINS: 'https://wedding.example',
      SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret', OPENAI_API_KEY: 'sk-test', ...env }).captionsGateway.publisher;
    assert.equal(runtime({}).guestSigner, null);
    assert.notEqual(runtime({ CAPTIONS_GUEST_SIGNING_KEY: signingKey }).guestSigner, null);
  } finally {
    if (saved === undefined) delete process.env.CAPTIONS_GUEST_SIGNING_KEY; else process.env.CAPTIONS_GUEST_SIGNING_KEY = saved;
  }
});

test('Vercel Node HTTP server accepts only allowed WebSocket origins', async () => {
  let attached = 0;
  const gateway = { acceptsOrigin: origin => origin === 'https://wedding.example', attach(socket) { attached += 1; socket.close(); } };
  const server = captionsStreamServer.createCaptionsStreamServer({ gateway });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = `ws://127.0.0.1:${server.address().port}`;
  const accepted = new WebSocket(address, { origin: 'https://wedding.example' });
  await once(accepted, 'close');
  assert.equal(attached, 1);
  const rejected = new WebSocket(address, { origin: 'https://evil.example' });
  const [error] = await once(rejected, 'error');
  assert.match(error.message, /403/);
  rejected.terminate();
  await new Promise(resolve => server.close(resolve));
});
