'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TurnBoundaryDetector, OpenAIRealtimeAsr } = require('../lib/captions/asr.cjs');
const { BoundedWorkQueue } = require('../lib/captions/queue.cjs');
const { normalizeDecision, OpenAIScriptAssistant } = require('../lib/captions/script-assist.cjs');
const { OpenAITranslationClient } = require('../lib/captions/translation.cjs');

test('pause detector discards prolonged silence and commits speech at a pause', () => {
  const detector = new TurnBoundaryDetector({ minTurnMs: 50, maxTurnMs: 100, silenceMs: 50, rmsThreshold: 0.01 });
  assert.equal(detector.add(new Int16Array(1200)), 'continue');
  assert.equal(detector.add(new Int16Array(1200)), 'discard');
  const speech = new Int16Array(1200).fill(4000);
  assert.equal(detector.add(speech), 'continue');
  assert.equal(detector.add(new Int16Array(1200)), 'commit');
});

test('ASR maps provider completions to commit order without assuming completion order', async () => {
  class FakeSocket extends EventEmitter {
    constructor() { super(); this.readyState = 0; this.sent = []; queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
    send(data) {
      const event = JSON.parse(data); this.sent.push(event);
      if (event.type === 'session.update') queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.updated', session: {} })));
    }
    close() { this.readyState = 3; this.emit('close', 1000); }
  }
  FakeSocket.OPEN = 1;
  const events = [];
  const asr = new OpenAIRealtimeAsr({ apiKey: 'test-key', WebSocket: FakeSocket });
  await asr.open(event => events.push(event));
  asr.commit(0); asr.commit(1);
  // A completed event can race ahead of its corresponding committed acknowledgement.
  asr.socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'second', transcript: '二' }));
  asr.socket.emit('message', JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'first' }));
  asr.socket.emit('message', JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'second' }));
  asr.socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'first', transcript: '一' }));
  assert.deepEqual(events.filter(event => event.type === 'completed').map(event => [event.segmentOrder, event.transcript]), [[1, '二'], [0, '一']]);
  assert.equal(asr.socket.sent[0].session.audio.input.turn_detection, null);
  assert.deepEqual(asr.socket.sent[0].session.audio.input.transcription.languages, ['yue', 'en']);
  asr.close();
});

test('bounded queue caps concurrency and supersedes queued drafts', async () => {
  let running = 0, peak = 0;
  const releases = [];
  const queue = new BoundedWorkQueue({ concurrency: 2, maxQueued: 4, worker: async value => {
    running += 1; peak = Math.max(peak, running);
    await new Promise(resolve => releases.push(resolve));
    running -= 1; return value;
  } });
  const first = queue.enqueue('first', { key: 'a' });
  const second = queue.enqueue('second', { key: 'b' });
  await new Promise(resolve => setImmediate(resolve));
  const oldDraft = queue.enqueue('old', { key: 'segment', replaceQueued: true });
  const newDraft = queue.enqueue('new', { key: 'segment', replaceQueued: true });
  assert.deepEqual(await oldDraft, { dropped: true, reason: 'superseded' });
  releases.shift()(); releases.shift()();
  await Promise.all([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()();
  assert.equal(await newDraft, 'new');
  assert.equal(peak, 2);
});

test('script suggestions never become effective text before operator review', () => {
  const accepted = normalizeDecision('我有十二支蠟燭', { decision: 'suggest', suggested_text: '我有十二支蜡烛',
    matched_cue_ids: [1], explanation: 'orthography' }, new Set([1]));
  assert.equal(accepted.reviewable, true);
  assert.equal(accepted.effectiveText, '我有十二支蠟燭');
  const blocked = normalizeDecision('I do not have 12', { decision: 'suggest', suggested_text: 'I have 13',
    matched_cue_ids: [1], explanation: 'change' }, new Set([1]));
  assert.equal(blocked.reviewable, false);
  assert.equal(blocked.rejectionReason, 'number_or_negation_changed');
});

test('script assistant reads raw Responses API output without SDK-only output_text', async () => {
  const assistant = new OpenAIScriptAssistant({ apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({
    status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ decision: 'suggest',
      suggested_text: '多謝大家今日來到', matched_cue_ids: [1], explanation: 'clear script match' }) }] }],
  }) }) });
  const result = await assistant.review({ rawText: '多謝大家今日嚟到', scriptCues: [{
    id: '00000000-0000-4000-8000-000000000001', sequence: 1, text: '多謝大家今日來到' }], prior: [] });
  assert.equal(result.reviewable, true);
  assert.equal(result.matchedScriptId, '00000000-0000-4000-8000-000000000001');
  assert.equal(result.effectiveText, '多謝大家今日嚟到');
});

test('translation rejects oversized source instead of truncating it', async () => {
  const client = new OpenAITranslationClient({ apiKey: 'test', fetchImpl: async () => { throw new Error('must not call'); } });
  await assert.rejects(() => client.translate({ language: 'en', currentSegment: 'x'.repeat(4001) }),
    error => error.code === 'translation_input_too_large');
});
