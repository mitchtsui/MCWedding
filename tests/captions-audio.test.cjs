'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The staging repository is ESM while the deployment target loads this UMD file as a classic script.
// Evaluate it with a CommonJS module object so this staged regression test exercises that same export.
const audioModule = { exports: {} };
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'live-captions-audio.js'), 'utf8'))(audioModule, audioModule.exports);
const Audio = audioModule.exports;

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

test('PC audio is explicitly prepared, produces frames without a microphone fallback, and stops every shared track', async t => {
  let constraints, microphoneCalls = 0, audioStopped = 0, videoStopped = 0;
  const audioTrack = { readyState: 'live', addEventListener() {}, stop() { audioStopped += 1; this.readyState = 'ended'; } };
  const videoTrack = { readyState: 'live', addEventListener() {}, stop() { videoStopped += 1; this.readyState = 'ended'; } };
  const stream = { getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack, videoTrack] };
  const mediaDevices = { getDisplayMedia: value => { constraints = value; return Promise.resolve(stream); }, getUserMedia: async () => { microphoneCalls += 1; throw new Error('must not use microphone'); } };
  class Context { constructor() { this.audioWorklet = { addModule: async () => {} }; this.destination = {}; this.state = 'running'; }
    createMediaStreamSource(value) { assert.equal(value, stream); return { connect() {} }; } createGain() { return { gain: {}, connect() {} }; } async close() { this.state = 'closed'; } }
  class Node { constructor() { this.port = { onmessage: null, postMessage() {} }; } connect() {} disconnect() {} }
  const original = global.AudioWorkletNode; global.AudioWorkletNode = Node; t.after(() => { global.AudioWorkletNode = original; });
  const frames = [], capture = new Audio.Capture({ mediaDevices, AudioContext: Context, onFrame: (...args) => frames.push(args) });
  await capture.prepareDisplay(); assert.equal(capture.hasPreparedDisplay(), true); assert.equal(capture.active(), false);
  assert.deepEqual(constraints, { video: true, audio: true, systemAudio: 'include', surfaceSwitching: 'exclude', selfBrowserSurface: 'exclude' });
  await capture.start('pc'); capture.node.port.onmessage({ data: { type: 'frame', audio: new ArrayBuffer(2400), samples: 1200 } });
  assert.equal(frames.length, 1); assert.equal(microphoneCalls, 0); assert.equal(capture.active(), true);
  await capture.stop(); assert.equal(audioStopped, 1); assert.equal(videoStopped, 1); assert.equal(capture.active(), false);
});

test('PC sharing rejects no-audio selection and cancellation without retaining or substituting a source', async () => {
  let videoStopped = 0, microphoneCalls = 0;
  const video = { addEventListener() {}, stop() { videoStopped += 1; } }, noAudio = { getAudioTracks: () => [], getTracks: () => [video] };
  const capture = new Audio.Capture({ mediaDevices: { getDisplayMedia: async () => noAudio, getUserMedia: async () => { microphoneCalls += 1; } } });
  await assert.rejects(capture.prepareDisplay(), /has no audio/); assert.equal(videoStopped, 1); assert.equal(capture.hasPreparedDisplay(), false); assert.equal(microphoneCalls, 0);
  const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const cancelled = new Audio.Capture({ mediaDevices: { getDisplayMedia: () => Promise.reject(denied), getUserMedia: async () => { microphoneCalls += 1; } } });
  await assert.rejects(cancelled.prepareDisplay(), error => error === denied); assert.equal(cancelled.hasPreparedDisplay(), false); assert.equal(microphoneCalls, 0);
  await assert.rejects(cancelled.start('pc'), /Share PC audio/); assert.equal(microphoneCalls, 0);
});

test('Stop disposes a display stream that arrives after its picker was cancelled', async () => {
  let resolvePicker, stopped = 0;
  const audio = { readyState: 'live', addEventListener() {}, stop() { stopped += 1; this.readyState = 'ended'; } };
  const video = { addEventListener() {}, stop() { stopped += 1; } }, stream = { getAudioTracks: () => [audio], getTracks: () => [audio, video] };
  const capture = new Audio.Capture({ mediaDevices: { getDisplayMedia: () => new Promise(resolve => { resolvePicker = resolve; }) } });
  const pending = capture.prepareDisplay(); await new Promise(resolve => setImmediate(resolve)); await capture.stop(); resolvePicker(stream);
  await assert.rejects(pending, /cancelled/); assert.equal(stopped, 2); assert.equal(capture.hasPreparedDisplay(), false);
});

test('PC start setup failure releases the prepared audio and video tracks', async () => {
  let stopped = 0;
  const audio = { readyState: 'live', addEventListener() {}, stop() { stopped += 1; this.readyState = 'ended'; } };
  const video = { addEventListener() {}, stop() { stopped += 1; } }, stream = { getAudioTracks: () => [audio], getTracks: () => [audio, video] };
  const capture = new Audio.Capture({ mediaDevices: { getDisplayMedia: async () => stream }, AudioContext: null });
  await capture.prepareDisplay(); await assert.rejects(capture.start('pc'), /unavailable/); assert.equal(stopped, 2); assert.equal(capture.active(), false); assert.equal(capture.hasPreparedDisplay(), false);
});

test('browser stop-sharing on either prepared or active PC media releases all tracks and reports the loss', async t => {
  const original = global.AudioWorkletNode; global.AudioWorkletNode = class { constructor() { this.port = { postMessage() {} }; } connect() {} disconnect() {} }; t.after(() => { global.AudioWorkletNode = original; });
  const makeStream = () => { const listeners = {}, stops = { audio: 0, video: 0 };
    const audio = { readyState: 'live', addEventListener: (_name, callback) => { listeners.audio = callback; }, stop() { stops.audio += 1; this.readyState = 'ended'; } };
    const video = { addEventListener: (_name, callback) => { listeners.video = callback; }, stop() { stops.video += 1; } };
    return { stream: { getAudioTracks: () => [audio], getTracks: () => [audio, video] }, listeners, stops }; };
  const first = makeStream(), ended = [];
  const capture = new Audio.Capture({ mediaDevices: { getDisplayMedia: async () => first.stream }, onDeviceEnded: value => ended.push(value) });
  await capture.prepareDisplay(); first.listeners.video(); assert.deepEqual(first.stops, { audio: 1, video: 1 }); assert.equal(capture.hasPreparedDisplay(), false); assert.deepEqual(ended, [{ source: 'pc', active: false }]);
  const second = makeStream(); capture.options.mediaDevices.getDisplayMedia = async () => second.stream;
  class Context { constructor() { this.audioWorklet = { addModule: async () => {} }; this.destination = {}; this.state = 'running'; } createMediaStreamSource() { return { connect() {} }; } createGain() { return { gain: {}, connect() {} }; } async close() { this.state = 'closed'; } }
  capture.options.AudioContext = Context; await capture.prepareDisplay(); await capture.start('pc'); second.listeners.audio(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(second.stops, { audio: 1, video: 1 }); assert.equal(capture.active(), false); assert.deepEqual(ended.at(-1), { source: 'pc', active: true });
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
