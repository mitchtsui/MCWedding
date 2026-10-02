'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeClientMessage, FRAME_BYTES, ProtocolError, captionBatch } = require('../lib/captions/protocol.cjs');

test('audio protocol accepts only exact 50ms PCM16 frames', () => {
  const audio = Buffer.alloc(FRAME_BYTES, 7);
  const parsed = decodeClientMessage(JSON.stringify({ type: 'audio', captureEpoch: 'capture-1', sequence: 0,
    sampleOffset: 0, audio: audio.toString('base64') }));
  assert.equal(parsed.audio.length, 2400);
  assert.throws(() => decodeClientMessage(JSON.stringify({ type: 'audio', captureEpoch: 'capture-1', sequence: 0,
    sampleOffset: 0, audio: Buffer.alloc(100).toString('base64') })), error => error instanceof ProtocolError && error.code === 'invalid_audio_frame');
});

test('the first auth message carries the ticket in the body', () => {
  assert.deepEqual(decodeClientMessage(JSON.stringify({ type: 'auth', ticket: 'one-time-ticket' })),
    { type: 'auth', ticket: 'one-time-ticket' });
  assert.throws(() => decodeClientMessage('{bad'), error => error.code === 'invalid_json');
});

test('normal end uses an explicit drain message', () => {
  assert.deepEqual(decodeClientMessage(JSON.stringify({ type: 'drain', reason: 'end' })), { type: 'drain', reason: 'end' });
  assert.throws(() => decodeClientMessage(JSON.stringify({ type: 'drain', reason: 'stop' })),
    error => error.code === 'unsupported_message');
});

test('caption batches preserve generation, epoch and revision ordering fields', () => {
  const payload = captionBatch({ eventId: 'event', runId: 'run', modeGeneration: 3, channelEpoch: 'epoch', messageSeq: 8,
    language: 'ja', publishedAt: 0, updates: [{ segmentId: 'segment', segmentOrder: 2, sourceRevision: 4,
      captionRevision: 4, language: 'ja', status: 'final', origin: 'ai_live', text: '字幕' }] });
  assert.equal(payload.type, 'caption.batch');
  assert.equal(payload.modeGeneration, 3);
  assert.equal(payload.updates[0].captionRevision, 4);
});
