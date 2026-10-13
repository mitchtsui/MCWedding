'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptionGateway, GatewaySession } = require('../lib/captions/gateway.cjs');

function sessionWith(store, translator = { async translate() { throw new Error('Unexpected paid work'); } }) {
  const sent = [];
  const gateway = new CaptionGateway({ store, translator, publisher: { async publish() {} }, asrFactory: () => ({}) });
  const session = new GatewaySession({ gateway, socket: { readyState: 1, send(value) { sent.push(JSON.parse(value)); } }, origin: 'https://local.test' });
  session.context = { eventId: 'e', runId: 'r', modeGeneration: 1, fencingToken: 9, channelEpoch: 'epoch' };
  session.authenticated = true;
  return { session, sent };
}

test('stop during a pending fence read cannot start a translation request afterwards', async () => {
  let resolveState, calls = 0;
  const store = { getRunState: () => new Promise(resolve => { resolveState = resolve; }) };
  const { session } = sessionWith(store, { async translate() { calls++; return { text: 'Should never run' }; } });
  const work = session.translate('en', { modeGeneration: 1, fencingToken: 9,
    source: { segmentId: 's', segmentOrder: 0, sourceRevision: 1, text: 'Speech' }, status: 'final', context: [] });
  assert.equal(typeof resolveState, 'function');
  session.stop('emergency_stop');
  resolveState({ state: 'live', modeGeneration: 1, fencingToken: 9 });
  assert.deepEqual(await work, { dropped: true, reason: 'stale_generation' });
  assert.equal(calls, 0);
});

test('rotation waits for recognized source checkpoints but does not stall on translation lanes', async () => {
  let sourceSaved, checkedLanes = false;
  const { session, sent } = sessionWith({ async recordOperationalEvent() {} });
  session.asr = { async drain() {}, close() {} };
  session.processing = new Promise(resolve => { sourceSaved = resolve; });
  session.lanes.onIdle = () => { checkedLanes = true; return new Promise(() => {}); };
  const rotating = session.prepareRotation();
  await Promise.resolve();
  assert.equal(sent.some(message => message.type === 'rotate'), false);
  assert.equal(sent[0].status, 'rotation.preparing');
  sourceSaved();
  await rotating;
  assert.equal(checkedLanes, false);
  assert.equal(sent.at(-1).type, 'rotate');
  session.stop('test_complete');
});
