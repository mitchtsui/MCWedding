'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Audio = require('../live-captions-audio.js');

test('capture requires an explicit device, emits frames, and stops tracks immediately', async t => {
  let constraints, stopped = 0, closed = 0, posted = null;
  const track = { addEventListener() {}, stop() { stopped += 1; } };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const mediaDevices = { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Lectern' }, { kind: 'videoinput', deviceId: 'cam' }],
    getUserMedia: async value => { constraints = value; return stream; } };
  class Context { constructor() { this.audioWorklet = { addModule: async () => {} }; this.destination = {}; this.state = 'running'; }
    createMediaStreamSource() { return { connect() {} }; } createGain() { return { gain: {}, connect() {} }; }
    async close() { this.state = 'closed'; closed += 1; } }
  class Node { constructor() { this.port = { onmessage: null, postMessage: value => { posted = value; } }; } connect() {} disconnect() {} }
  const original = global.AudioWorkletNode; global.AudioWorkletNode = Node; t.after(() => { global.AudioWorkletNode = original; });
  const frames = [], capture = new Audio.Capture({ mediaDevices, AudioContext: Context, onFrame: (buffer, samples) => frames.push([buffer, samples]) });
  await assert.rejects(capture.start(''), /Select a microphone/);
  assert.deepEqual(await capture.devices(), [{ id: 'mic-1', label: 'Lectern' }]);
  await capture.start('mic-1');
  assert.deepEqual(constraints.audio.deviceId, { exact: 'mic-1' });
  capture.node.port.onmessage({ data: { type: 'frame', audio: new ArrayBuffer(2400), samples: 1200 } });
  assert.equal(frames.length, 1);
  const oldHandler = capture.node.port.onmessage; await capture.stop(); oldHandler({ data: { type: 'frame', audio: new ArrayBuffer(2400), samples: 1200 } });
  assert.equal(capture.active(), false); assert.equal(stopped, 1); assert.equal(closed, 1); assert.deepEqual(posted, { type: 'reset' });
  assert.equal(frames.length, 1, 'stale worklet messages are ignored after stop');
});

test('permit asks for microphone access and releases the stream at once without capturing', async () => {
  let constraints, stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  const capture = new Audio.Capture({ mediaDevices: { getUserMedia: async value => { constraints = value; return stream; } } });
  await capture.permit();
  assert.deepEqual(constraints, { audio: true, video: false }); assert.equal(stopped, 1); assert.equal(capture.active(), false);
  await assert.rejects(new Audio.Capture({ mediaDevices: {} }).permit(), /unavailable/);
});

test('stop cancels a pending permission request and disposes its late stream', async t => {
  let resolvePermission, stopped = 0, moduleLoaded = 0;
  const stream = { getAudioTracks: () => [{ addEventListener() {}, stop() { stopped += 1; } }], getTracks() { return this.getAudioTracks(); } };
  const mediaDevices = { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }) };
  class Context { constructor() { this.audioWorklet = { addModule: async () => { moduleLoaded += 1; } }; this.state = 'running'; } async close() {} }
  const original = global.AudioWorkletNode; global.AudioWorkletNode = class {}; t.after(() => { global.AudioWorkletNode = original; });
  const capture = new Audio.Capture({ mediaDevices, AudioContext: Context });
  const pending = capture.start('mic-1'); await new Promise(resolve => setImmediate(resolve)); await capture.stop(); resolvePermission(stream);
  await assert.rejects(pending, /cancelled/); assert.equal(stopped, 1); assert.equal(moduleLoaded, 0); assert.equal(capture.active(), false);
});

test('failed worklet setup releases capture resources', async t => {
  let stopped = 0, closed = 0;
  const track = { addEventListener() {}, stop() { stopped += 1; } }, stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  class Context { constructor() { this.audioWorklet = { addModule: async () => { throw new Error('module failed'); } }; this.state = 'running'; } async close() { closed += 1; } }
  const original = global.AudioWorkletNode; global.AudioWorkletNode = class {}; t.after(() => { global.AudioWorkletNode = original; });
  const capture = new Audio.Capture({ mediaDevices: { getUserMedia: async () => stream }, AudioContext: Context });
  await assert.rejects(capture.start('mic-1'), /module failed/); assert.equal(capture.active(), false); assert.equal(stopped, 1); assert.equal(closed, 1);
});

test('capture resumes a suspended context and device-ended alarm stops capture', async t => {
  let ended, resumed = 0, alarmed = 0, stopped = 0;
  const track = { addEventListener: (_name, callback) => { ended = callback; }, stop: () => { stopped += 1; } };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  class Context { constructor() { this.audioWorklet = { addModule: async () => {} }; this.destination = {}; this.state = 'suspended'; }
    async resume() { resumed += 1; this.state = 'running'; } createMediaStreamSource() { return { connect() {} }; }
    createGain() { return { gain: {}, connect() {} }; } async close() { this.state = 'closed'; } }
  class Node { constructor() { this.port = { onmessage: null, postMessage() {} }; } connect() {} disconnect() {} }
  const original = global.AudioWorkletNode; global.AudioWorkletNode = Node; t.after(() => { global.AudioWorkletNode = original; });
  const capture = new Audio.Capture({ mediaDevices: { getUserMedia: async () => stream }, AudioContext: Context, onDeviceEnded: () => { alarmed += 1; } });
  await capture.start('mic-1'); assert.equal(resumed, 1); ended(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(alarmed, 1); assert.equal(capture.active(), false); assert.equal(stopped, 1);
});

test('worklet statefully resamples to exact 50ms PCM16 frames and reset drops partial audio', () => {
  let Processor;
  class Base { constructor() { this.port = { onmessage: null, messages: [], postMessage: (value, transfer) => this.port.messages.push({ value, transfer }) }; } }
  const context = { AudioWorkletProcessor: Base, sampleRate: 48000, registerProcessor: (name, value) => { assert.equal(name, 'caption-pcm-processor'); Processor = value; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'live-captions-worklet.js'), 'utf8'), context);
  const processor = new Processor(), chunk = new Float32Array(128).fill(0.5);
  for (let index = 0; index < 20; index += 1) processor.process([[chunk]]);
  const frame = processor.port.messages.find(item => item.value.type === 'frame');
  assert.ok(frame); assert.equal(frame.value.samples, 1200); assert.equal(frame.value.audio.byteLength, 2400); assert.equal(frame.transfer[0], frame.value.audio);
  processor.process([[chunk]]); assert.ok(processor.frame.length > 0); processor.port.onmessage({ data: { type: 'reset' } });
  assert.equal(processor.frame.length, 0); assert.equal(processor.input.length, 0); assert.equal(processor.position, 0);
});

test('base64 encoder preserves all PCM bytes', () => {
  const original = global.btoa; global.btoa = value => Buffer.from(value, 'binary').toString('base64');
  try { assert.equal(Audio.bytesToBase64(Uint8Array.from([0, 1, 254, 255]).buffer), 'AAH+/w=='); }
  finally { global.btoa = original; }
});
