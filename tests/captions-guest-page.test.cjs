/* Guest page regressions. Runs the real live-captions-guest.js and live-captions-client.js in a vm, against the real
   api/captions.js handler and guest signer, with only the database (Supabase REST) and Realtime faked. Every caption
   or heartbeat delivered to the page is genuinely server-signed; replays are made by signing with an earlier clock. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHandler } = require('../api/captions.js');
const { createGuestSigner } = require('../lib/captions/guest-link.cjs');

const root = path.join(__dirname, '..');
const pageCode = fs.readFileSync(path.join(root, 'live-captions-guest.js'), 'utf8');
const clientCode = fs.readFileSync(path.join(root, 'live-captions-client.js'), 'utf8');
const realNow = Date.now.bind(Date), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, ms = 4000) => { const end = realNow() + ms; while (realNow() < end) { if (predicate()) return true; await sleep(5); } return false; };
const EVENT = '11111111-1111-4111-8111-111111111111', RUN1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', RUN2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EPOCH = { [RUN1]: '0e0e0e0e-0000-4000-8000-000000000001', [RUN2]: '0e0e0e0e-0000-4000-8000-000000000002' };
const KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const env = { CAPTIONS_ENABLED: 'true', CAPTIONS_GUEST_LINKS: 'true', CAPTIONS_GUEST_SIGNING_KEY: KEY,
  CAPTIONS_ALLOWED_ORIGINS: 'https://wedding.test', SUPABASE_URL: 'https://x.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const signer = createGuestSigner(env);
let addresses = 0;

function setup({ currentRun = RUN2 } = {}) {
  const db = { tokenValid: true, currentRun, failNext: 0, generation: { [RUN1]: 1, [RUN2]: 1 } };
  const update = (language, text, order) => ({ segmentId: 'seg-' + order, segmentOrder: order, sourceRevision: 1, captionRevision: 1, status: 'final', origin: 'ai_live', text, language });
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, options) => {
    const args = JSON.parse(options.body || '{}');
    if (db.failNext > 0) { db.failNext -= 1; return reply(503, {}); }
    if (url.endsWith('/rpc/caption_guest_access')) return db.tokenValid && args.p_token === 'good-token'
      ? reply(200, { event_id: EVENT, run_id: db.currentRun, expires_at: '2099-01-01T00:00:00Z' }) : reply(403, { code: '28000', message: 'guest link unavailable' });
    if (url.endsWith('/rpc/caption_snapshot')) {
      if (!EPOCH[args.p_run_id]) return reply(400, { code: 'P0002' });
      return reply(200, { eventId: EVENT, runId: args.p_run_id, currentRunId: db.currentRun, modeGeneration: db.generation[args.p_run_id], channelEpoch: EPOCH[args.p_run_id],
        messageSeq: 1, status: 'live', language: args.p_language, topic: 'caption:private', updates: [update(args.p_language, `Snapshot ${args.p_run_id === RUN1 ? 'one' : 'two'}`, 1)] });
    }
    throw new Error('unexpected request ' + url);
  };
  const state = { handler: createHandler({ env, fetchImpl }) };
  const batch = (runId, language, seq, text, extra = {}) => ({ schemaVersion: 1, type: 'caption.batch', eventId: EVENT, runId, modeGeneration: db.generation[runId],
    channelEpoch: EPOCH[runId], messageSeq: seq, language, updates: text ? [update(language, text, seq)] : [], ...extra });
  const heartbeat = (runId, language, seq, status) => ({ type: 'heartbeat', eventId: EVENT, runId, modeGeneration: db.generation[runId], channelEpoch: EPOCH[runId],
    language, messageSeq: seq, status, publishedAt: new Date().toISOString() });
  const sealed = (topicLanguage, payload, ageMs = 0) => { const now = Date.now; Date.now = () => realNow() - ageMs;
    try { return signer.envelope(signer.topicFor(EVENT, topicLanguage), payload); } finally { Date.now = now; } };

  function open({ timeMap = ms => ms, failSnapshots = [] } = {}) {
    const elements = {}, listeners = {}, buttons = [], channels = [], counts = { snapshots: 0 }, plan = [...failSnapshots];
    const element = id => ({ id, textContent: '', hidden: false, dataset: {}, children: [], className: '', disabled: false,
      style: { setProperty() {} }, setAttribute() {}, removeAttribute() {}, getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
      replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); }, addEventListener() {}, scrollIntoView() {} });
    for (const language of ['en', 'ja', 'zh-CN']) { const button = element('language-' + language); button.dataset.language = language; button.listeners = {};
      button.addEventListener = (type, handler) => { button.listeners[type] = handler; }; buttons.push(button); }
    const storage = new Map(), context = {}, location = { search: `?live=1&event=${EVENT}`, hash: '#token=good-token', pathname: '/live-captions.html' };
    const supabase = { createClient: () => ({ auth: {},
      channel(topic) { const channel = { topic, handlers: {}, closed: false, on(_kind, filter, handler) { channel.handlers[filter.event] = handler; return channel; },
        subscribe(callback) { setTimeout(() => { if (!channel.closed) callback('SUBSCRIBED'); }, 20); return channel; } }; channels.push(channel); return channel; },
      removeChannel(channel) { channel.closed = true; } }) };
    const document = { getElementById: id => (elements[id] ||= element(id)), querySelectorAll: selector => selector === '[data-language]' ? buttons : [],
      createElement: tag => element(tag), documentElement: { lang: '', style: { setProperty() {} } }, title: '', hidden: false, addEventListener: (type, handler) => { listeners[type] = handler; },
      head: { append(script) {
        if (script.src === '/api/config.js') Object.assign(context, { SUPABASE_URL: 'https://x.supabase.test', SUPABASE_ANON_KEY: 'anon' });
        else if (script.src === 'vendor/supabase.js') context.supabase = supabase;
        else if (script.src === 'live-captions-client.js') vm.runInContext(clientCode, context);
        setTimeout(() => script.onload()); } } };
    const address = `203.0.113.${++addresses}`;
    const pageFetch = async (url, options) => {
      const body = options.method === 'GET' ? undefined : JSON.parse(options.body);
      if (body?.action === 'guestSnapshot') { counts.snapshots += 1; const next = plan.shift(); if (next === 'slow-fail') await sleep(200); if (next === 'fail' || next === 'slow-fail') return { ok: false, status: 503, json: async () => ({ ok: false, error: { code: 'SUPABASE_UNAVAILABLE', message: 'Caption storage is unavailable' } }) }; }
      const response = { statusCode: 0, body: '', setHeader() {}, end(value) { this.body = value; } };
      await state.handler({ method: options.method, url, headers: { origin: 'https://wedding.test', 'x-forwarded-for': address }, body, socket: {} }, response);
      return { ok: response.statusCode < 300, status: response.statusCode, json: async () => JSON.parse(response.body) };
    };
    Object.assign(context, { document, location, navigator: { language: 'en' }, console, URLSearchParams, Promise, JSON, Date, Math, Object, Array, Number, String, Error, Set, Map,
      history: { replaceState() { location.hash = ''; } }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
      matchMedia: () => ({ matches: false }), requestAnimationFrame: callback => callback(), innerHeight: 800, scrollBy() {}, addEventListener() {},
      crypto: globalThis.crypto, fetch: pageFetch, atob, TextEncoder, setTimeout: (handler, ms, ...rest) => setTimeout(handler, timeMap(ms ?? 0), ...rest).unref(), clearTimeout });
    context.window = context;
    vm.createContext(context); vm.runInContext(pageCode, context);
    const deliver = (channelLanguage, event, envelope) => { for (const channel of channels) if (!channel.closed && channel.topic === signer.topicFor(EVENT, channelLanguage)) channel.handlers[event]?.({ payload: envelope }); };
    const page = { counts, buttons, listeners, location, storage, plan, topics: () => channels.filter(channel => !channel.closed).map(channel => channel.topic),
      emit: (language, event, value, ageMs = 0) => deliver(language, event, sealed(language, value, ageMs)), deliver,
      view: () => ({ status: elements.statusLine?.dataset.status, notice: elements.statusNotice?.textContent || '', latest: elements.latestText?.textContent || '' }),
      open: () => channels.filter(channel => !channel.closed).map(channel => channel.topic.split(':')[2]) };
    return page;
  }
  return { db, state, fetchImpl, batch, heartbeat, sealed, open, topic: language => signer.topicFor(EVENT, language) };
}
const ready = page => until(() => page.view().latest.startsWith('Snapshot two'));
const outageAfter = (ms, delay) => value => value === ms ? delay : value;

test('a guest reads signed captions with no account; unsigned and forged ones are ignored', async () => {
  const world = setup(), page = world.open();
  assert.ok(await ready(page)); assert.equal(page.location.hash, '', 'the code leaves the address bar'); assert.equal(page.view().status, 'playing');
  page.deliver('en', 'caption.batch', world.batch(RUN2, 'en', 2, 'Unsigned'));
  page.deliver('en', 'caption.batch', { data: JSON.stringify({ topic: 'x', iat: realNow(), payload: world.batch(RUN2, 'en', 2, 'Forged') }), sig: 'A'.repeat(86) });
  page.deliver('en', 'caption.batch', world.sealed('ja', world.batch(RUN2, 'en', 2, 'Signed for another channel')));
  page.emit('en', 'caption.batch', world.batch(RUN2, 'en', 2, 'Genuine line'));
  assert.ok(await until(() => page.view().latest === 'Genuine line'));
});

test('replayed old heartbeats neither change the status nor make the phone reload', async () => {
  const world = setup(), page = world.open(); assert.ok(await ready(page));
  page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 1, 'live')); await sleep(30);
  page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 1, 'paused'), 60000);
  page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 1, 'disconnected'), 600000); await sleep(50);
  assert.equal(page.view().status, 'playing');
  const before = page.counts.snapshots;
  for (let index = 0; index < 50; index += 1) page.emit('en', 'heartbeat', world.heartbeat(RUN1, 'en', 9, 'live'), 600000);
  await sleep(100); assert.equal(page.counts.snapshots, before, 'messages older than two minutes are dropped before they can trigger anything');
});

test('a manual caption does not make later live heartbeats look stale', async () => {
  const world = setup(), page = world.open({ timeMap: outageAfter(25000, 300) }); assert.ok(await ready(page));
  page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 1, 'live')); await sleep(30);
  page.emit('en', 'caption.batch', world.batch(RUN2, 'en', 129, 'Manual correction')); await sleep(30);
  for (let index = 0; index < 4; index += 1) { page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 2, 'live')); await sleep(150); }
  assert.deepEqual([page.view().status, page.view().notice], ['playing', ''], 'the outage timer never fires on a healthy stream');
  page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 2, 'disconnected')); await sleep(30);
  assert.equal(page.view().status, 'waiting', 'a real disconnect is still shown');
});

test('ended and paused stay as they are instead of turning into a lost connection', async () => {
  for (const status of ['ended', 'paused']) {
    const world = setup(), page = world.open({ timeMap: outageAfter(25000, 200) }); assert.ok(await ready(page));
    page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 1, 'live')); await sleep(30);
    world.db.generation[RUN2] = 2; page.emit('en', 'caption.batch', world.batch(RUN2, 'en', 2, '', { status })); await sleep(400);
    assert.deepEqual([page.view().status, page.view().notice], [status, ''], status);
  }
});

test('a refused link closes the page and later captions are not shown', async () => {
  const world = setup(), page = world.open(); assert.ok(await ready(page));
  world.db.tokenValid = false; await sleep(5100); page.listeners.visibilitychange();
  assert.ok(await until(() => page.view().status === 'ended')); assert.deepEqual(page.open(), []);
  page.emit('en', 'caption.batch', world.batch(RUN2, 'en', 2, 'Spoken after expiry')); await sleep(50);
  assert.notEqual(page.view().latest, 'Spoken after expiry');
});

test('a language switch hit by one failed request recovers on its own instead of leaving the page silent', async () => {
  const world = setup(), page = world.open(); assert.ok(await ready(page));
  page.plan.push('fail'); page.buttons[1].listeners.click();
  assert.ok(await until(() => page.view().status === 'waiting'));
  assert.ok(await until(() => page.topics().join() === world.topic('ja') && page.view().status === 'playing', 8000), 'the switch is retried');
  page.emit('ja', 'caption.batch', world.batch(RUN2, 'ja', 2, '新しい字幕'));
  assert.ok(await until(() => page.view().latest === '新しい字幕'));
});

test('a signing-key change followed by one failed request moves the page to the new channel', async () => {
  const world = setup(), page = world.open(); assert.ok(await ready(page));
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const rotated = createGuestSigner({ ...env, CAPTIONS_GUEST_SIGNING_KEY: key });
  world.state.handler = createHandler({ env: { ...env, CAPTIONS_GUEST_SIGNING_KEY: key }, fetchImpl: world.fetchImpl });
  page.plan.push('ok', 'fail'); page.listeners.visibilitychange();
  assert.ok(await until(() => page.topics().join() === rotated.topicFor(EVENT, 'en') && page.view().status === 'playing', 8000), 'resubscribed to the new channel');
});

test('a caption that arrives during a failed catch-up is still shown', async () => {
  const world = setup(), page = world.open(); assert.ok(await ready(page)); await sleep(5100);
  // The caption arrives while the failing catch-up is still in flight, so the page has to hold it and then apply it.
  page.plan.push('slow-fail'); page.listeners.visibilitychange(); await sleep(60);
  page.emit('en', 'caption.batch', world.batch(RUN2, 'en', 2, 'After the outage'));
  assert.ok(await until(() => page.view().latest === 'After the outage', 2000));
  assert.equal(page.open().length, 1, 'a passing outage never closes the page');
});

test('a phone waiting before the speeches follows the new run within seconds of it starting', async () => {
  const world = setup({ currentRun: null }), page = world.open();
  assert.ok(await until(() => /No captions are live/.test(page.view().notice)));
  world.db.currentRun = RUN2; await sleep(5100);
  const started = realNow(); page.emit('en', 'heartbeat', world.heartbeat(RUN2, 'en', 1, 'live'));
  assert.ok(await until(() => page.view().latest.startsWith('Snapshot two'), 8000)); assert.ok(realNow() - started < 7000);
});
