/* Operator lifecycle regressions. Drives the real live-captions-admin.js in a vm with local fakes; the fake API
   answers like api/captions.js over caption_start_run, caption_transition_run and caption_issue_uplink_ticket. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const adminSource = fs.readFileSync(path.join(__dirname, '..', 'live-captions-admin.js'), 'utf8');
const OPEN = ['starting', 'live', 'paused', 'ending', 'degraded'];
// Page timers and its clock run 20x fast, so the 3 s / 15 s / 20 s bounds are reached in a test-sized wait.
const SCALE = 20, realNow = Date.now.bind(Date), base = realNow();
class ScaledDate extends Date {
  constructor(...args) { if (args.length) super(...args); else super(ScaledDate.now()); }
  static now() { return base + (realNow() - base) * SCALE; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeoutMs = 4000) {
  const deadline = realNow() + timeoutMs;
  while (!predicate()) { if (realNow() >= deadline) throw new Error('Timed out waiting for ' + label); await sleep(2); }
}

async function makeApp({ keepBacklog = false, permission = 'granted' } = {}) {
  const gates = new Map();
  const gate = name => gates.has(name) ? new Promise(resolve => gates.get(name).push(resolve)) : Promise.resolve();
  // failNext: the request never reaches the server. loseReply: it is applied, then the reply is lost.
  // refuseNext: the server answers 400 for a reason that says nothing about the run (as a rate limit does).
  const server = { runs: new Map(), events: 0, calls: [], tickets: 0, failNext: new Map(), loseReply: new Map(), refuseNext: new Map(),
    pendingRecognizedFinalSources: 0, pendingRecognizedFinalsTruncated: false, pendingRecognizedFinalsChecked: true,
    drainReply: { withGap: false, delivery: { attempted: 0, delivered: 0, failed: 0, unresolvedFailed: 0 }, failures: { captions: 0, sources: 0 } } };
  const rejected = (status, code) => Object.assign(new Error('Caption request was rejected'), { status, code });
  const notOpen = run => run ? rejected(409, 'RUN_NOT_OPEN') : rejected(404, 'NOT_FOUND');
  const take = (map, action) => { const left = map.get(action) ?? 0; if (left > 0) map.set(action, left - 1); return left > 0; };
  async function request(action, payload = {}) {
    server.calls.push(action + (payload.runId ? ':' + payload.runId : payload.reviewId ? ':' + payload.reviewId : ''));
    if (take(server.failNext, action)) throw new Error('Caption service unavailable');
    if (take(server.refuseNext, action)) throw rejected(400, 'INVALID_REQUEST');
    await gate('before:' + action); // held on its way to the server, before any effect
    const run = payload.runId ? server.runs.get(payload.runId) : null; let result = {};
    if (action === 'config' || action === 'preflight') result = { enabled: true, guestLinksReady: false };
    else if (action === 'createEvent') { server.events += 1; result = { eventId: 'event-' + server.events }; }
    else if (action === 'start') {
      const open = [...server.runs.entries()].find(([, item]) => item.eventId === payload.eventId && OPEN.includes(item.state));
      if (open) result = { eventId: payload.eventId, runId: open[0], alreadyOpen: true };
      else { const runId = 'run-' + (server.runs.size + 1); server.runs.set(runId, { eventId: payload.eventId, state: 'live' }); result = { eventId: payload.eventId, runId }; }
    } else if (['pause', 'resume', 'end', 'stop'].includes(action)) {
      const allowed = run && (action === 'pause' ? run.state === 'live' : action === 'resume' ? run.state === 'paused' : ['starting', 'live', 'paused', 'degraded'].includes(run.state));
      if (!allowed) { await gate(action); throw notOpen(run); }
      run.state = { pause: 'paused', resume: 'live', end: 'ended', stop: 'stopped' }[action]; result = { runId: payload.runId, state: run.state,
        ...(action === 'end' ? { pendingRecognizedFinalSources: server.pendingRecognizedFinalSources,
          pendingRecognizedFinalsTruncated: server.pendingRecognizedFinalsTruncated,
          pendingRecognizedFinalsChecked: server.pendingRecognizedFinalsChecked } : {}) };
    } else if (action === 'ticket') { if (!run || !['live', 'degraded'].includes(run.state)) { await gate(action); throw notOpen(run); } server.tickets += 1; result = { token: 'ticket-' + server.tickets }; }
    else if (action === 'snapshot') result = { topic: `caption:${payload.eventId}:${payload.language}`, updates: [] };
    if (take(server.loseReply, action)) throw new Error('Caption service unavailable');
    await gate(action); // the server-side effect has happened; only the reply is held back
    return result;
  }

  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, { id, textContent: '', disabled: false, hidden: false, dataset: {}, value: '', placeholder: '', onclick: null, onsubmit: null,
    previousElementSibling: { textContent: '' }, options: [], replaceChildren(...nodes) { this.options = nodes; }, append(node) { this.options.push(node); } }); return elements.get(id); };
  const sockets = [], listeners = {};
  class FakeSocket {
    constructor() { this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); gate('ws-open').then(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } }); }
    send(data) { if (this.readyState !== 1) return; const message = JSON.parse(data); this.sent.push(message);
      if (keepBacklog && message.type === 'audio') this.bufferedAmount += data.length;
      if (message.type === 'auth') gate('ws-ready').then(() => this.serverSend({ type: 'ready' }));
      if (message.type === 'drain') gate('drain').then(() => this.serverSend({ type: 'status', status: 'drained', reason: message.reason, ...server.drainReply })); }
    close() { if (this.readyState < 2) { this.readyState = 3; setTimeout(() => this.onclose?.({}), 0); } }
    serverSend(message) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) }); }
    serverClose() { if (this.readyState < 2) { this.readyState = 3; this.onclose?.({}); } }
    audio() { return this.sent.filter(message => message.type === 'audio'); }
    types() { return this.sent.map(message => message.type); }
  }
  FakeSocket.OPEN = 1;
  let capture = null;
  class FakeCapture {
    constructor(options) { this.options = options; this.running = false; this.starts = 0; this.permits = 0; capture = this; }
    // Like Chrome: until access is granted, one input is listed with no id and a generic name.
    async devices() { return permission === 'granted' ? [{ id: 'mic-1', label: 'Lectern microphone' }] : [{ id: '', label: 'Microphone' }]; }
    async permit() { this.permits += 1; if (permission === 'deny') throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); permission = 'granted'; }
    async start(deviceId) { if (!deviceId) throw new Error('Select a microphone first'); await gate('capture.start'); this.running = true; this.starts += 1; }
    async stop() { this.running = false; }
    frame() { if (this.running) this.options.onFrame(new ArrayBuffer(2400), 1200); return this.running; }
  }
  const context = { console, clearTimeout, URLSearchParams, URL, Date: ScaledDate, setTimeout: (handler, ms = 0, ...args) => setTimeout(handler, ms / SCALE, ...args),
    crypto: { randomUUID }, WebSocket: FakeSocket, Option: class { constructor(label, value) { this.label = label; this.value = value; } }, addEventListener: (name, handler) => { listeners[name] = handler; },
    location: { search: '?live=1', protocol: 'https:', host: 'wedding.example', origin: 'https://wedding.example', href: 'https://wedding.example/live-captions-admin.html?live=1' },
    document: { title: '', getElementById: $, querySelectorAll: () => [], createElement: () => ({}), head: { append: script => Promise.resolve().then(() => script.onload?.()) } } };
  context.window = context;
  context.CaptionsAudio = { Capture: FakeCapture, bytesToBase64: () => 'A'.repeat(3200) };
  context.CaptionsLive = { languages: ['en', 'ja', 'zh-CN'], create: () => ({ request }), createSupabase: () => ({ auth: {} }), accessToken: async () => 'admin-session',
    CaptionStore: class { merge() { return true; } segments() { return []; } }, keepRealtimeAuth() {}, cleanError: message => message,
    subscribe(_client, _topic, _onBatch, onState) { Promise.resolve().then(() => onState('SUBSCRIBED')); return { close() {} }; } };
  vm.createContext(context);
  vm.runInContext(adminSource, context, { filename: 'live-captions-admin.js' });

  const text = () => $('status-text').textContent;
  const app = { $, server, sockets, text, get capture() { return capture; },
    hold(name) { if (!gates.has(name)) gates.set(name, []); },
    held(name) { return gates.get(name)?.length ?? 0; },
    release(name) { const waiting = gates.get(name) ?? []; gates.delete(name); waiting.forEach(resolve => resolve()); },
    releaseOne(name, index) { gates.get(name).splice(index, 1)[0](); },
    click(name) { const button = $(name + '-button'); if (button.disabled) return false; void button.onclick(); return true; },
    enabled() { return ['start', 'pause', 'resume', 'end', 'stop'].filter(name => !$(name + '-button').disabled).join(','); },
    runs() { return [...server.runs.entries()].map(([id, run]) => `${id}:${run.state}`).join(' '); },
    socket() { return sockets[sockets.length - 1]; },
    pagehide() { listeners.pagehide(); },
    frames(count) { let produced = 0; for (let index = 0; index < count; index += 1) if (capture.frame()) produced += 1; return produced; },
    until: (expected, timeoutMs) => waitFor(() => text().includes(expected), `status "${expected}" (now "${text()}")`, timeoutMs),
    live: () => waitFor(() => text() === 'Live microphone connected', `live (now "${text()}")`),
    async goLive() { $('audio-device').value = 'mic-1'; assert.equal(app.click('start'), true); await app.live(); return app; } };
  await waitFor(() => typeof $('start-button').onclick === 'function', 'operator page initialisation');
  return app;
}
const firstFrame = socket => { const frame = socket.audio()[0]; return { sequence: frame.sequence, sampleOffset: frame.sampleOffset, epoch: frame.captureEpoch }; };
const review = id => ({ type: 'review', reviewId: 'review-' + id, reviewable: true, rawText: id + ' raw', proposedText: id + ' script', matchedCueIds: [1] });

test('Start without a microphone creates no event or run', async () => {
  const app = await makeApp();
  assert.equal(app.click('start'), true); await sleep(20);
  assert.equal(app.text(), 'Select a microphone first'); assert.deepEqual(app.server.calls.filter(call => /^(createEvent|start)/.test(call)), []);
  assert.equal(app.enabled(), 'start');
});

test('a browser that has not granted microphone access is asked first, then lists selectable devices', async () => {
  const app = await makeApp({ permission: 'prompt' }), select = app.$('audio-device'), refresh = app.$('refresh-devices');
  assert.deepEqual(select.options.map(option => [option.value, option.label]), [['', 'Allow microphone access to list devices']], 'an input without an id is never offered');
  assert.equal(refresh.textContent, 'Allow microphone'); assert.match(app.text(), /press Allow microphone/);
  await refresh.onclick(); assert.equal(app.capture.permits, 1);
  assert.deepEqual(select.options.map(option => option.value), ['', 'mic-1']); assert.equal(refresh.textContent, 'Refresh devices');
  assert.equal(app.text(), 'Ready - select a microphone, then start');
  select.value = 'mic-1'; app.click('start'); await app.live();
});

test('a refused microphone permission says how to recover and keeps asking', async () => {
  const app = await makeApp({ permission: 'deny' }), refresh = app.$('refresh-devices');
  await refresh.onclick();
  assert.match(app.$('audio-alert').textContent, /refused.*site settings/); assert.equal(refresh.textContent, 'Allow microphone');
  assert.deepEqual(app.server.calls.filter(call => /^(createEvent|start)/.test(call)), []);
});

test('a failure after the run exists leaves Reconnect and Emergency stop available on that run', async () => {
  const app = await makeApp(); app.$('audio-device').value = 'mic-1'; app.server.failNext.set('ticket', 1);
  app.click('start'); await app.until('Press Reconnect captions');
  assert.equal(app.runs(), 'run-1:live'); assert.equal(app.enabled(), 'start,stop'); assert.equal(app.$('start-button').textContent, 'Reconnect captions');
  app.click('start'); await app.live();
  assert.equal(app.server.calls.filter(call => call === 'start').length, 1, 'reattaching must not create a second run');
  assert.equal(app.$('start-button').textContent, 'Start live captions');
  app.frames(1); const first = firstFrame(app.socket());
  assert.ok(first.sequence >= 1, 'audio lost while detached is declared as a gap'); assert.equal(first.sampleOffset, first.sequence * 1200);
  app.click('stop'); await app.until('Captions stopped');
  assert.equal(app.runs(), 'run-1:stopped'); assert.equal(app.enabled(), 'start');
});

test('a Start whose reply is lost is found again instead of locking the operator out', async () => {
  const app = await makeApp(); app.$('audio-device').value = 'mic-1'; app.server.loseReply.set('start', 1);
  app.click('start'); await app.until('Caption service unavailable'); assert.equal(app.runs(), 'run-1:live'); assert.equal(app.enabled(), 'start');
  app.click('start'); await app.until('already has an open caption session');
  assert.equal(app.enabled(), 'start,stop'); assert.equal(app.sockets.length, 0, 'an open run found this way is not taken over unasked');
  app.click('start'); await app.live(); assert.equal(app.runs(), 'run-1:live'); assert.equal(app.server.events, 1);
  app.click('stop'); await app.until('Captions stopped'); assert.equal(app.runs(), 'run-1:stopped');
});

test('Emergency stop during a Start whose reply is late stops the run that Start created', async () => {
  const app = await makeApp(); app.$('audio-device').value = 'mic-1'; app.hold('start'); app.click('start');
  await waitFor(() => app.held('start') === 1, 'start in flight'); assert.equal(app.click('stop'), true); await app.until('Captions stopped');
  app.release('start'); await waitFor(() => app.runs() === 'run-1:stopped', 'late run stopped');
  assert.equal(app.enabled(), 'start'); assert.equal(app.sockets.length, 0); assert.equal(app.text(), 'Captions stopped');
});

test('a late stop reply does not repaint the page while a newer Start is connecting', async () => {
  const app = await makeApp(); app.$('audio-device').value = 'mic-1'; app.hold('start'); app.click('start');
  await waitFor(() => app.held('start') === 1, 'first start in flight'); app.click('stop'); await app.until('Captions stopped');
  app.hold('before:start'); app.hold('snapshot'); app.hold('stop'); app.click('start'); await waitFor(() => app.held('before:start') === 1, 'second start on its way');
  app.release('start'); await waitFor(() => app.held('stop') === 1, 'late stop'); assert.equal(app.runs(), 'run-1:stopped');
  app.release('before:start'); await waitFor(() => app.held('snapshot') >= 1, 'second start subscribing'); app.release('stop'); await sleep(20);
  assert.equal(app.enabled(), 'stop', 'the page stays in its connecting state'); assert.match(app.text(), /Starting live caption session/);
  app.release('snapshot'); await app.live(); assert.equal(app.runs(), 'run-1:stopped run-2:live');
});

test('a late Start reply does not stop the run the operator has since reattached to', async () => {
  const app = await makeApp(); app.$('audio-device').value = 'mic-1'; app.hold('start'); app.click('start');
  await waitFor(() => app.held('start') === 1, 'first start in flight'); app.click('stop'); await app.until('Captions stopped');
  app.click('start'); await waitFor(() => app.held('start') === 2, 'second start in flight'); app.releaseOne('start', 1); await app.until('already has an open caption session');
  app.click('start'); await app.live(); app.releaseOne('start', 0); await sleep(30);
  assert.equal(app.runs(), 'run-1:live'); assert.equal(app.capture.running, true); assert.equal(app.text(), 'Live microphone connected');
  assert.ok(!app.server.calls.includes('stop:run-1'), 'the late reply must not send a stop for the run now in use');
});

test('a microphone that disconnects while live does not strand the open run', async () => {
  const app = await (await makeApp()).goLive();
  app.capture.options.onDeviceEnded(); void app.capture.stop();
  assert.match(app.text(), /microphone disconnected/); assert.equal(app.enabled(), 'start,stop');
  assert.equal(app.sockets.filter(socket => socket.readyState === 1).length, 0);
  app.click('stop'); await app.until('Captions stopped'); assert.equal(app.runs(), 'run-1:stopped');
});

test('Pause stops the microphone immediately and waits for already-captured work before changing run state', async () => {
  const app = await (await makeApp()).goLive(); app.frames(3); const stream = app.socket(); app.hold('drain');
  app.click('pause'); await waitFor(() => app.held('drain') === 1, 'pause drain');
  assert.equal(app.capture.running, false); assert.equal(app.frames(1), 0, 'no audio is captured after Pause');
  assert.equal(app.runs(), 'run-1:live'); assert.ok(!app.server.calls.includes('pause:run-1'));
  assert.equal(stream.types().at(-1), 'drain'); assert.equal(stream.sent.at(-1).reason, 'pause');
  app.release('drain'); await app.until('last captured words completed');
  assert.equal(app.runs(), 'run-1:paused'); assert.equal(app.enabled(), 'resume,end,stop');
});

test('Emergency stop cancels a pending Pause drain without restarting the microphone', async () => {
  const app = await (await makeApp()).goLive(); app.hold('drain'); app.click('pause');
  await waitFor(() => app.held('drain') === 1, 'pause drain'); assert.equal(app.capture.running, false);
  assert.equal(app.click('stop'), true); await app.until('Captions stopped'); app.release('drain'); await sleep(20);
  assert.equal(app.runs(), 'run-1:stopped'); assert.equal(app.capture.running, false);
  assert.ok(!app.server.calls.includes('pause:run-1'), 'cancelled Pause never changes the stopped run');
});

test('a failed Pause drain keeps the open run recoverable and never claims it paused', async () => {
  const app = await (await makeApp()).goLive(); app.hold('drain'); app.click('pause');
  await waitFor(() => app.held('drain') === 1, 'pause drain'); app.socket().serverClose();
  await app.until('Pause was not confirmed');
  assert.equal(app.runs(), 'run-1:live'); assert.equal(app.capture.running, false); assert.equal(app.enabled(), 'start,stop');
  assert.ok(!app.server.calls.includes('pause:run-1')); app.release('drain');
});

test('a late drain reply from a replaced socket cannot complete the current Pause', async () => {
  const app = await (await makeApp()).goLive(); const old = app.socket(); old.serverClose();
  await waitFor(() => app.socket() !== old && app.socket().readyState === 1 && app.capture.running, 'replacement stream');
  app.hold('drain'); app.click('pause'); await waitFor(() => app.held('drain') === 1, 'current pause drain');
  old.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'drained', reason: 'pause', withGap: false,
    delivery: { attempted: 0, delivered: 0, failed: 0, unresolvedFailed: 0 }, failures: { captions: 0, sources: 0 } }) });
  await sleep(20); assert.equal(app.runs(), 'run-1:live'); assert.ok(!app.server.calls.includes('pause:run-1'));
  app.release('drain'); await app.until('last captured words completed'); assert.equal(app.runs(), 'run-1:paused');
});

test('an unplanned reconnect starts a new epoch above sequence 0 so the server records the gap', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); const before = app.socket(), epoch = firstFrame(before).epoch;
  await sleep(10); before.serverClose();
  await waitFor(() => app.socket() !== before && app.text() === 'Live microphone connected', 'reconnect'); app.frames(1);
  const first = firstFrame(app.socket()), next = app.socket();
  assert.notEqual(first.epoch, epoch); assert.ok(first.sequence >= 1); assert.equal(first.sampleOffset, first.sequence * 1200);
  app.click('pause'); await app.until('Captions paused'); assert.equal(next.audio().length, 1, 'a stream that already sent audio needs no marker frame');
});

test('a reconnected stream that is paused before any frame still declares its gap', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); const before = app.socket(); await sleep(10); before.serverClose();
  await waitFor(() => app.socket() !== before && app.text() === 'Live microphone connected', 'reconnect'); const next = app.socket();
  app.click('pause'); await app.until('Captions paused');
  assert.equal(next.audio().length, 1, 'one silent frame carries the declaration'); assert.ok(next.audio()[0].sequence >= 1);
});

test('a handoff announcement from the socket being replaced cannot strand the new stream', async () => {
  const app = await (await makeApp()).goLive(); const old = app.socket(); old.serverClose();
  old.onmessage({ data: JSON.stringify({ type: 'status', status: 'rotation.preparing' }) });
  await waitFor(() => app.socket() !== old && app.text() === 'Live microphone connected', 'reconnect');
  assert.equal(app.frames(20), 20); assert.equal(app.socket().audio().length, 20, 'audio on the new stream is uploaded, not buffered');
});

test('a stream that closes while the microphone restarts is not reported as live', async () => {
  const app = await (await makeApp()).goLive(); const old = app.socket(); app.hold('capture.start'); old.serverClose();
  await waitFor(() => app.held('capture.start') === 1, 'microphone restart'); app.socket().serverClose(); app.release('capture.start');
  await app.until('Audio gap'); assert.equal(app.enabled(), 'start,stop'); assert.equal(app.capture.running, false);
});

test('a stream that keeps dropping stops retrying and hands the choice to the operator', async () => {
  const app = await (await makeApp()).goLive();
  for (let drop = 0; drop < 3; drop += 1) { const old = app.socket(); old.serverClose(); await waitFor(() => app.socket() !== old && app.text() === 'Live microphone connected', 'reconnect ' + drop); }
  const sockets = app.sockets.length; app.socket().serverClose(); await app.until('keeps disconnecting');
  assert.equal(app.sockets.length, sockets, 'no fourth automatic attempt'); assert.equal(app.enabled(), 'start,stop');
  app.click('start'); await app.live(); const manual = app.socket(); manual.serverClose();
  await waitFor(() => app.socket() !== manual && app.text() === 'Live microphone connected', 'a manual Reconnect resets the limit');
});

test('leaving the page while paused keeps the paused controls', async () => {
  const app = await (await makeApp()).goLive(); app.click('pause'); await app.until('Captions paused'); app.pagehide();
  assert.equal(app.text(), 'Captions paused'); assert.equal(app.enabled(), 'resume,end,stop');
  app.click('resume'); await app.live(); assert.equal(app.runs(), 'run-1:live');
});

test('leaving the page while live does not leave a restored page claiming to capture', async () => {
  const app = await (await makeApp()).goLive(); app.pagehide();
  assert.match(app.text(), /this page was left/); assert.equal(app.enabled(), 'start,stop'); assert.equal(app.capture.running, false);
  assert.equal(app.sockets.filter(socket => socket.readyState === 1).length, 0);
});

test('a reconnect that fails keeps Emergency stop usable', async () => {
  const app = await (await makeApp()).goLive(); app.server.failNext.set('ticket', 1); app.socket().serverClose();
  await app.until('Audio gap'); assert.equal(app.enabled(), 'start,stop'); assert.equal(app.capture.running, false);
  app.click('stop'); await app.until('Captions stopped'); assert.equal(app.runs(), 'run-1:stopped'); assert.equal(app.$('audio-alert').textContent, '');
});

test('a scheduled handoff replays buffered audio in order and declares overflow', async () => {
  const app = await (await makeApp()).goLive(); app.frames(3); const old = app.socket();
  old.serverSend({ type: 'status', status: 'rotation.preparing' }); app.frames(75); old.serverSend({ type: 'rotate', reason: 'function_duration' });
  await waitFor(() => app.socket() !== old && app.socket().audio().length === 60, 'replay');
  const replay = app.socket().audio();
  assert.deepEqual({ sequence: replay[0].sequence, sampleOffset: replay[0].sampleOffset }, { sequence: 15, sampleOffset: 18000 });
  assert.ok(replay.every((frame, index) => frame.sequence === 15 + index && frame.sampleOffset === (15 + index) * 1200));
  assert.equal(app.capture.starts, 1, 'the handoff keeps the selected microphone running');
});

test('a failed handoff falls back to one reconnect with a declared gap instead of abandoning capture', async () => {
  const app = await (await makeApp()).goLive(); app.frames(3); const old = app.socket();
  old.serverSend({ type: 'status', status: 'rotation.preparing' }); app.frames(10); app.server.failNext.set('ticket', 1); old.serverSend({ type: 'rotate', reason: 'function_duration' });
  await waitFor(() => app.socket() !== old && app.text() === 'Live microphone connected', 'fallback reconnect'); app.frames(1);
  assert.ok(firstFrame(app.socket()).sequence >= 1); assert.equal(app.capture.starts, 2); assert.equal(app.enabled(), 'pause,end,stop');
});

test('an announced handoff that never arrives is started from the operator side', async () => {
  const app = await (await makeApp()).goLive(); const old = app.socket();
  old.serverSend({ type: 'status', status: 'rotation.preparing' }); app.frames(5);
  await waitFor(() => app.socket() !== old && app.socket().audio().length === 5, 'watchdog handoff');
  assert.equal(app.text(), 'Live microphone connected');
});

test('End during a handoff uploads the buffered words before draining', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); const old = app.socket();
  old.serverSend({ type: 'status', status: 'rotation.preparing' }); app.frames(10); app.hold('ticket'); old.serverSend({ type: 'rotate', reason: 'function_duration' });
  await waitFor(() => app.held('ticket') === 1, 'handoff ticket'); app.frames(5);
  assert.equal(app.click('end'), true); await sleep(10); assert.match(app.text(), /Completing the stream handoff/);
  app.release('ticket'); await app.until('Captions ended after the final words completed');
  const sent = app.socket().types();
  assert.equal(old.audio().length + app.socket().audio().length, 20, 'every captured frame was uploaded');
  assert.equal(sent.indexOf('drain'), sent.lastIndexOf('audio') + 1, 'the drain follows the replayed audio');
  assert.equal(app.runs(), 'run-1:ended'); assert.equal(app.enabled(), 'start');
});

test('Pause during a handoff stops the microphone, replays its existing buffer, then drains', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); const old = app.socket();
  old.serverSend({ type: 'status', status: 'rotation.preparing' }); app.frames(10); app.hold('ticket');
  old.serverSend({ type: 'rotate', reason: 'function_duration' }); await waitFor(() => app.held('ticket') === 1, 'handoff ticket');
  app.click('pause'); await waitFor(() => app.capture.running === false, 'microphone stopped');
  assert.equal(app.frames(5), 0); app.release('ticket'); await app.until('last captured words completed');
  const current = app.socket();
  assert.equal(old.audio().length + current.audio().length, 15, 'only audio captured before Pause is uploaded');
  assert.equal(current.types().indexOf('drain'), current.types().lastIndexOf('audio') + 1);
  assert.equal(app.capture.starts, 1, 'the handoff never restarts the microphone');
  assert.equal(app.runs(), 'run-1:paused');
});

test('End after a handoff that lost audio declares the gap and does not claim a clean finish', async () => {
  const failed = await (await makeApp()).goLive(); failed.frames(5); const old = failed.socket();
  old.serverSend({ type: 'status', status: 'rotation.preparing' }); failed.frames(10); failed.server.failNext.set('ticket', 1); failed.hold('ws-ready');
  old.serverSend({ type: 'rotate', reason: 'function_duration' }); await waitFor(() => failed.held('ws-ready') === 1, 'fallback reconnect');
  assert.equal(failed.click('end'), true); failed.release('ws-ready'); await failed.until('Captions ended');
  assert.match(failed.text(), /explicit final-audio gap/); assert.deepEqual(failed.socket().types(), ['auth', 'audio', 'drain']);
  assert.ok(failed.socket().audio()[0].sequence >= 1, 'the frames discarded with the failed handoff are declared before the drain');
  const overflowed = await (await makeApp()).goLive(); const live = overflowed.socket();
  live.serverSend({ type: 'status', status: 'rotation.preparing' }); overflowed.frames(100); overflowed.hold('ticket'); live.serverSend({ type: 'rotate', reason: 'function_duration' });
  await waitFor(() => overflowed.held('ticket') === 1, 'handoff ticket'); overflowed.click('end'); overflowed.release('ticket'); await overflowed.until('Captions ended');
  assert.match(overflowed.text(), /explicit final-audio gap/); assert.equal(overflowed.socket().audio()[0].sequence, 40);
});

test('End just after a lossy handoff still reports the gap; End long after a healed reconnect is clean', async () => {
  const lossy = await (await makeApp()).goLive(); const live = lossy.socket();
  live.serverSend({ type: 'status', status: 'rotation.preparing' }); lossy.frames(100); live.serverSend({ type: 'rotate', reason: 'function_duration' });
  await waitFor(() => lossy.socket() !== live && lossy.text() === 'Live microphone connected', 'handoff'); lossy.click('end'); await lossy.until('Captions ended');
  assert.match(lossy.text(), /explicit final-audio gap/);
  const healed = await (await makeApp()).goLive(); healed.frames(5); const before = healed.socket(); before.serverClose();
  await waitFor(() => healed.socket() !== before && healed.text() === 'Live microphone connected', 'reconnect'); healed.frames(5);
  await sleep(10000 / SCALE + 100); healed.click('end'); await healed.until('Captions ended');
  assert.match(healed.text(), /after the final words completed/);
});

test('End on a run that has closed elsewhere says so and returns to a clean Start', async () => {
  const app = await (await makeApp()).goLive(); app.server.runs.get('run-1').state = 'stopped';
  app.click('end'); await app.until('already closed'); assert.equal(app.enabled(), 'start'); assert.equal(app.sockets.filter(socket => socket.readyState === 1).length, 0);
});

test('End reports finals that were not saved or translated', async () => {
  const app = await (await makeApp()).goLive(); app.server.drainReply = { withGap: true, delivery: { attempted: 0, delivered: 0, failed: 0, unresolvedFailed: 0 }, failures: { captions: 2, sources: 1 } };
  app.click('end'); await app.until('Captions ended');
  assert.match(app.text(), /recognized final speech could not be saved or fully translated/); assert.equal(app.runs(), 'run-1:ended');
});

test('End while paused ends the run without a stream', async () => {
  const app = await (await makeApp()).goLive(); app.click('pause'); await app.until('Captions paused'); assert.equal(app.enabled(), 'resume,end,stop');
  app.server.pendingRecognizedFinalSources = 2; app.click('end'); await app.until('Captions ended');
  assert.match(app.text(), /recognized final speech could not be saved or fully translated/); assert.equal(app.runs(), 'run-1:ended'); assert.equal(app.enabled(), 'start');
});

test('End while paused does not claim completeness when the pending-final check is unavailable', async () => {
  const app = await (await makeApp()).goLive(); app.click('pause'); await app.until('Captions paused');
  app.server.pendingRecognizedFinalsChecked = false; app.click('end'); await app.until('Captions ended');
  assert.match(app.text(), /could not be fully checked/); assert.equal(app.runs(), 'run-1:ended');
});

test('a clean live drain cannot claim completion when the durable pending-final check is unavailable or truncated', async () => {
  const unavailable = await (await makeApp()).goLive(); unavailable.server.pendingRecognizedFinalsChecked = false;
  unavailable.click('end'); await unavailable.until('Captions ended'); assert.match(unavailable.text(), /could not be fully checked/);
  const truncated = await (await makeApp()).goLive(); truncated.server.pendingRecognizedFinalsTruncated = true;
  truncated.click('end'); await truncated.until('Captions ended'); assert.match(truncated.text(), /could not be fully checked/);
});

test('Resume after an intentional pause starts at sequence 0 with no declared gap', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); app.click('pause'); await app.until('Captions paused'); await sleep(20);
  app.click('resume'); await app.live(); app.frames(1);
  assert.deepEqual({ sequence: firstFrame(app.socket()).sequence, sampleOffset: firstFrame(app.socket()).sampleOffset }, { sequence: 0, sampleOffset: 0 });
});

test('audio lost after a resume that could not reconnect is counted from the resume, not from before the pause', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); app.click('pause'); await app.until('Captions paused'); await sleep(300);
  app.server.failNext.set('ticket', 1); app.click('resume'); await app.until('Press Reconnect captions'); assert.equal(app.runs(), 'run-1:live');
  app.click('start'); await app.live(); app.frames(1); const lost = firstFrame(app.socket()).sequence;
  assert.ok(lost >= 1 && lost < 60, `the paused interval (about 120 frames) must not be declared as lost audio; declared ${lost}`);
});

test('a Resume whose reply is lost declares audio from that attempt, not the pause before it', async () => {
  const app = await (await makeApp()).goLive(); app.frames(5); app.click('pause'); await app.until('Captions paused'); await sleep(500);
  app.server.loseReply.set('resume', 1); app.click('resume'); await app.until('Resume failed'); assert.equal(app.runs(), 'run-1:live'); await sleep(100);
  app.click('resume'); await app.until('Press Reconnect captions'); app.click('start'); await app.live(); app.frames(1);
  const lost = firstFrame(app.socket()).sequence;
  assert.ok(lost >= 30 && lost < 150, `expected the gap since the first resume attempt (about 40 frames), without the 200-frame pause; declared ${lost}`);
});

test('a Pause whose reply is lost is recovered by Reconnect, which resumes the same run', async () => {
  const app = await (await makeApp()).goLive(); app.server.loseReply.set('pause', 1);
  app.click('pause'); await app.until('was not confirmed by the server'); assert.equal(app.runs(), 'run-1:paused'); assert.equal(app.capture.running, false);
  app.click('start'); await app.live(); assert.equal(app.runs(), 'run-1:live');
  assert.deepEqual(app.server.calls.slice(-3), ['ticket:run-1', 'resume:run-1', 'ticket:run-1']);
});

test('Reconnect on a run that has closed elsewhere returns to a clean Start', async () => {
  const app = await (await makeApp()).goLive(); app.capture.options.onDeviceEnded(); void app.capture.stop(); app.server.runs.get('run-1').state = 'stopped';
  app.click('start'); await app.until('already ended'); assert.equal(app.enabled(), 'start'); assert.equal(app.$('start-button').textContent, 'Start live captions');
  app.click('start'); await app.live(); assert.equal(app.runs(), 'run-1:stopped run-2:live');
});

test('Emergency stop that fails can be retried, and a double click cannot leave a stale run behind', async () => {
  const app = await (await makeApp()).goLive(); app.server.failNext.set('stop', 1);
  app.click('stop'); await app.until('was not confirmed by the server');
  assert.equal(app.runs(), 'run-1:live'); assert.equal(app.capture.running, false); assert.equal(app.enabled(), 'start,stop');
  app.hold('stop'); app.click('stop'); await waitFor(() => app.held('stop') === 1, 'first stop'); assert.equal(app.click('stop'), true);
  await waitFor(() => app.held('stop') === 2, 'second stop'); app.release('stop'); await app.until('Captions stopped');
  assert.equal(app.runs(), 'run-1:stopped'); assert.equal(app.enabled(), 'start');
  app.click('start'); await app.live(); app.click('stop'); await app.until('Captions stopped');
  assert.equal(app.runs(), 'run-1:stopped run-2:stopped', 'Emergency stop targets the current run'); assert.equal(app.server.calls.at(-1), 'stop:run-2');
});

test('only a not-open reply closes the run on the page; an unrelated refusal keeps it stoppable', async () => {
  const refused = await (await makeApp()).goLive(); refused.server.refuseNext.set('stop', 1);
  refused.click('stop'); await refused.until('was not confirmed by the server');
  assert.equal(refused.runs(), 'run-1:live'); assert.equal(refused.enabled(), 'start,stop', 'a 400 that says nothing about the run must not drop it');
  refused.click('stop'); await refused.until('Captions stopped'); assert.equal(refused.runs(), 'run-1:stopped');
  const closed = await (await makeApp()).goLive(); closed.server.runs.get('run-1').state = 'ended';
  closed.click('stop'); await closed.until('already closed'); assert.equal(closed.enabled(), 'start');
});

test('a stream refused or closed before it is ready is reported instead of hanging', async () => {
  const refused = await makeApp(); refused.$('audio-device').value = 'mic-1'; refused.hold('ws-ready'); refused.click('start');
  await waitFor(() => refused.held('ws-ready') === 1, 'authentication');
  refused.socket().serverSend({ type: 'error', code: 'stale_ticket', message: 'The uplink ticket is no longer valid.' }); refused.socket().serverClose();
  await refused.until('no longer valid'); assert.equal(refused.enabled(), 'start,stop');
  const closed = await makeApp(); closed.$('audio-device').value = 'mic-1'; closed.hold('ws-ready'); closed.click('start');
  await waitFor(() => closed.held('ws-ready') === 1, 'authentication'); closed.socket().serverClose();
  await closed.until('closed before it was ready'); assert.equal(closed.enabled(), 'start,stop'); assert.equal(closed.runs(), 'run-1:live');
});

test('script suggestions queue behind the one on screen, stay bounded and do not outlive their run', async () => {
  const app = await (await makeApp()).goLive(); const socket = app.socket();
  socket.serverSend(review('A')); socket.serverSend(review('B'));
  assert.equal(app.$('review-proposed').textContent, 'A script'); assert.equal(app.$('review-cues').textContent, '1 (1 more waiting)');
  void app.$('review-approve').onclick(); await waitFor(() => app.$('review-proposed').textContent === 'B script', 'next suggestion');
  assert.equal(app.server.calls.at(-1), 'review:review-A'); assert.equal(app.$('review-approve').disabled, false);
  for (let index = 0; index < 30; index += 1) socket.serverSend(review('N' + index));
  assert.equal(app.$('review-proposed').textContent, 'B script', 'the suggestion being read is never displaced'); assert.equal(app.$('review-cues').textContent, '1 (19 more waiting)');
  app.click('stop'); await app.until('Captions stopped'); assert.equal(app.$('review-approve').disabled, true); assert.equal(app.$('review-raw').textContent, 'No pending suggestion.');
});

test('the upload backlog is measured in queued bytes and a replayed buffer gets time to flush', async () => {
  const app = await (await makeApp({ keepBacklog: true })).goLive(); const live = app.socket();
  app.frames(60); assert.equal(live.audio().length, 60, 'three seconds of queued frames is not yet a backlog'); assert.equal(app.socket(), live);
  live.bufferedAmount = 0; live.serverSend({ type: 'status', status: 'rotation.preparing' }); app.frames(60); live.serverSend({ type: 'rotate', reason: 'function_duration' });
  await waitFor(() => app.socket() !== live && app.socket().audio().length === 60, 'replay'); const next = app.socket();
  app.frames(3); assert.equal(app.socket(), next, 'a full replay must not trigger an immediate reconnect'); assert.equal(next.audio().length, 63);
  await sleep(3000 / SCALE + 30); app.frames(1);
  await waitFor(() => app.socket() !== next, 'a backlog that outlasts the grace period reconnects');
});
