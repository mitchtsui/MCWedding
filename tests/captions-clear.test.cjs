'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptionStore } = require('../live-captions-client.js');
const { guestPayload } = require('../lib/captions/delivery.cjs');
const { validateCaptionUpdate } = require('../lib/captions/protocol.cjs');
const caption = (order, language = 'en') => ({ segmentId: 's' + order, segmentOrder: order,
  sourceRevision: 1, captionRevision: 1, status: 'corrected', origin: 'manual', text: 'Synthetic ' + order, language });
const clear = (order, language = 'en') => ({ ...caption(order, language), origin: 'system', text: '', clear: true });

test('Clear removes current and earlier captions, survives replay, and Next restores display', () => {
  const store = new CaptionStore();
  store.mergeUpdate(caption(1)); store.mergeUpdate(caption(2));
  store.mergeUpdate(clear(3));
  assert.equal(store.isCleared('en'), true);
  assert.deepEqual(store.segments('en'), []);
  assert.equal(store.mergeUpdate(caption(1)), false);
  assert.equal(store.mergeUpdate(clear(3)), false);
  store.mergeUpdate(caption(4));
  assert.equal(store.isCleared('en'), false);
  assert.deepEqual(store.segments('en').map(item => item.segmentOrder), [4]);
  store.mergeUpdate(clear(3));
  assert.deepEqual(store.segments('en').map(item => item.segmentOrder), [4]);
});

test('out-of-order Clear preserves newer captions and each language has its own watermark', () => {
  const store = new CaptionStore();
  store.mergeUpdate(caption(1)); store.mergeUpdate(caption(4)); store.mergeUpdate(caption(1, 'ja'));
  store.mergeUpdate(clear(3));
  assert.equal(store.isCleared('en'), false);
  assert.deepEqual(store.segments('en').map(item => item.segmentOrder), [4]);
  assert.equal(store.segments('ja').length, 1);
  store.mergeUpdate(clear(3, 'ja'));
  assert.equal(store.isCleared('ja'), true);
  store.reset();
  assert.equal(store.isCleared('ja'), false);
  assert.equal(store.mergeUpdate(caption(1)), true);
});

test('snapshot reconstruction retains Clear even when older updates arrive afterwards', () => {
  const store = new CaptionStore();
  for (const update of [clear(3), caption(2), caption(1)]) store.mergeUpdate(update);
  assert.equal(store.isCleared('en'), true);
  assert.deepEqual(store.segments('en'), []);
});

test('protocol and guest payload preserve only valid Clear markers', () => {
  const valid = clear(2);
  assert.equal(validateCaptionUpdate(valid).clear, true);
  const batch = { type: 'caption.batch', eventId: 'event', runId: 'run', language: 'en', updates: [valid] };
  assert.equal(guestPayload(batch).updates[0].clear, true);
  for (const invalid of [{ ...valid, text: 'not empty' }, { ...valid, origin: 'manual' }]) {
    assert.throws(() => validateCaptionUpdate(invalid), { code: 'invalid_caption' });
    assert.equal(guestPayload({ ...batch, updates: [invalid] }).updates[0].clear, undefined);
    assert.equal(new CaptionStore().mergeUpdate(invalid), false);
  }
});
