'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Live = require('../live-captions-client.js');

test('operator password session calls use same-origin cookies and never put the password in a URL or header', async () => {
  const calls = [];
  const api = Live.create({ fetch: async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { authenticated: true, expiresAt: '2026-11-12T16:00:00.000Z' } }) };
  } });

  await api.request('operatorStatus');
  await api.request('operatorLogin', { password: 'one-time-test-value' });
  await api.request('operatorLogout');

  assert.deepEqual(calls.map(call => [call.url, call.options.method, call.options.credentials]), [
    ['/api/captions.js?action=operatorStatus', 'GET', 'same-origin'],
    ['/api/captions.js', 'POST', 'same-origin'],
    ['/api/captions.js', 'POST', 'same-origin']
  ]);
  assert.deepEqual(calls[1].body, { action: 'operatorLogin', password: 'one-time-test-value' });
  assert.deepEqual(calls[2].body, { action: 'operatorLogout' });
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, undefined);
    assert.doesNotMatch(call.url, /one-time-test-value/);
  }
});

test('hub operator mode stays captions-only and reports session and invite state to its same-origin parent', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'live-captions-admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'live-captions-admin.html'), 'utf8');

  assert.match(admin, /hub = live && params\.get\('hub'\) === '1'/);
  assert.match(admin, /if \(!hub\) \{ await load\('\/api\/config\.js'\); await load\('vendor\/supabase\.js'\); \}/,
    'hub mode does not load the Supabase browser client');
  assert.match(admin, /if \(hub\) return await api\.request\(action, payload\)/,
    'hub protected requests rely on the HttpOnly cookie rather than a browser token');
  assert.match(admin, /request\('snapshot', \{ \.\.\.scope, language \}\)/,
    'hub captions are refreshed through the cookie-authorized snapshot endpoint');
  assert.match(admin, /wedding-hub-caption-state/);
  assert.match(admin, /wedding-hub-caption-invite/);
  assert.match(admin, /new URL\('live-captions\.html', location\.href\); link\.search = new URLSearchParams\(\{ live: '1', event: eventId \}\); link\.hash = new URLSearchParams\(\{ token: invite\.token \}\)/,
    'hub-generated guest links open the direct account-free viewer while keeping the token in the fragment');
  assert.match(admin, /error\?\.code === 'HUB_UNAUTHENTICATED'/);
  assert.match(admin, /wedding-hub-session-expired/);
  assert.match(admin, /Local capture has stopped/);
  assert.match(html, /id="live-auth-password" type="password" autocomplete="current-password" minlength="6" required disabled hidden/);
  assert.doesNotMatch(html, /id="live-auth-password"[^>]*maxlength=/,
    'the configured caption password may become longer without a frontend change');
  assert.match(html, /id="hub-logout" type="button" hidden/);
  assert.match(html, /id="hub-session-retry" type="button" hidden/);
  assert.match(html, /id="hub-entrance-link"[^>]*target="_top" hidden/);
  assert.match(admin, /if \(closed \|\| polling \|\| operation !== lifecycleGeneration\) return/,
    'a language never starts an overlapping snapshot request');
  assert.match(admin, /close\(\) \{ closed = true; clearTimeout\(timer\); \}/,
    'closing a subscription clears its pending poll');
  assert.match(admin, /setTimeout\(poll, 2000\)/,
    'three language polls stay below the shared 120 requests per minute limit');
  assert.doesNotMatch(admin, /setTimeout\(poll, 1000\)/);
  assert.match(admin, /\$\('hub-logout'\)\.disabled = \['connecting', 'sharing'\]\.includes\(state\) \|\| Boolean\(pendingRunId\)/,
    'logout is disabled while a lifecycle transition can still create or change a run');
  assert.match(admin, /if \(\['connecting', 'sharing'\]\.includes\(phase\) \|\| pendingRunId\)/,
    'the logout handler also guards programmatic activation during a transition');
  assert.match(admin, /emitHubState\(Boolean\(runId \|\| pendingRunId \|\| \['connecting', 'sharing'\]\.includes\(state\)\)\)/,
    'the parent locks its shared logout before a pending lifecycle action allocates ids');
  assert.doesNotMatch(admin, /localStorage|sessionStorage/);
});

test('hub reauthentication retries transient status and preflight failures while preserving a held run', async () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'live-captions-admin.js'), 'utf8');
  const elements = new Map(), listeners = new Map(), parentMessages = [], calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { id, hidden: false, disabled: false, required: false, value: '', textContent: '', dataset: {}, options: [], style: {},
      previousElementSibling: { textContent: '' }, replaceChildren(...values) { this.options = values; }, append(value) { this.options.push(value); } });
    return elements.get(id);
  };
  const nav = element('nav'), grid = element('grid'), parentWindow = { postMessage(value) { parentMessages.push(value); } };
  let hubSession = true, failRestoredStatus = false, failRestoredPreflight = false, failRestoredPreflightAuth = false, startSeen = false, releaseStart, capture, socketCount = 0;
  const startReply = new Promise(resolve => { releaseStart = resolve; });
  const rejected = code => Object.assign(new Error('Session unavailable'), { status: 401, code });
  const api = { async request(action) {
    calls.push(action);
    if (action === 'config') return { enabled: true, guestLinksReady: true };
    if (action === 'operatorStatus') { if (!hubSession) throw rejected('HUB_UNAUTHENTICATED'); if (failRestoredStatus) { failRestoredStatus = false; throw new Error('Temporary status failure'); } return { authenticated: true }; }
    if (!hubSession) throw rejected('HUB_UNAUTHENTICATED');
    if (action === 'preflight') { if (failRestoredPreflight) { failRestoredPreflight = false; throw new Error('Temporary preflight failure'); } if (failRestoredPreflightAuth) { failRestoredPreflightAuth = false; throw rejected('UNAUTHENTICATED'); } return { enabled: true, guestLinksReady: true }; }
    if (action === 'createEvent') return { eventId: 'event-1' };
    if (action === 'start') { startSeen = true; await startReply; return { runId: 'run-1' }; }
    return {};
  } };
  class Capture {
    constructor(options) { this.options = options; this.stops = 0; capture = this; }
    async devices() { return [{ id: 'mic-1', label: 'Mic' }]; }
    async stop() { this.stops += 1; this.running = false; }
    hasPreparedDisplay() { return false; }
    discardPrepared() {}
  }
  const context = { console, URL, URLSearchParams, Option: class { constructor(label, value) { this.label = label; this.value = value; } },
    location: { search: '?hub=1&live=1', protocol: 'https:', host: 'wedding.test', origin: 'https://wedding.test', href: 'https://wedding.test/live-captions-admin.html?hub=1&live=1' },
    parent: parentWindow, clearTimeout, setTimeout, crypto: { randomUUID: () => 'epoch-1' },
    addEventListener(type, handler) { const values = listeners.get(type) || []; values.push(handler); listeners.set(type, values); },
    document: { title: '', getElementById: element, querySelector(selector) { return selector === '.admin-nav' ? nav : selector === '.operator-grid' ? grid : null; },
      querySelectorAll(selector) { return selector === '.live-only' ? ['live-auth-panel', 'live-device-panel', 'live-invite-panel', 'review-panel', 'content-tools'].map(element) : []; },
      createElement() { return {}; }, head: { append(script) { Promise.resolve().then(() => script.onload?.()); } } },
    CaptionsPreview: {}, CaptionsAudio: { Capture, bytesToBase64: () => '' }, CaptionsLive: {
      languages: ['en', 'ja', 'zh-CN'], create: () => api, cleanError: value => String(value || 'Request failed'),
      CaptionStore: class { merge() {} segments() { return []; } }
    }, WebSocket: class { constructor() { socketCount += 1; } } };
  context.window = context;
  vm.createContext(context); vm.runInContext(admin, context, { filename: 'live-captions-admin.js' });
  const waitFor = async predicate => { const limit = Date.now() + 1000; while (!predicate()) { if (Date.now() > limit) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 2)); } };
  const dispatch = data => listeners.get('message').forEach(handler => handler({ origin: context.location.origin, source: parentWindow, data }));

  await waitFor(() => typeof element('start-button').onclick === 'function');
  element('audio-device').value = 'mic-1'; void element('start-button').onclick(); await waitFor(() => startSeen);
  assert.equal(element('hub-logout').disabled, true);
  hubSession = false; dispatch({ type: 'wedding-hub-session-lock' });
  assert.equal(grid.hidden, true); assert.ok(capture.stops > 0); assert.equal(parentMessages.at(-1).active, true, 'a pending Start keeps the parent logout locked');
  releaseStart(); await waitFor(() => calls.filter(value => value === 'stop').length === 1);
  hubSession = true; failRestoredStatus = true; failRestoredPreflight = true; dispatch({ type: 'wedding-hub-session-restored' });
  await waitFor(() => element('hub-session-retry').hidden === false);
  assert.equal(grid.hidden, true); assert.equal(element('live-auth-form').hidden, true);
  assert.equal(calls.filter(value => value === 'snapshot').length, 0); assert.equal(socketCount, 0);
  element('hub-session-retry').onclick();
  await waitFor(() => calls.filter(value => value === 'preflight').length === 2 && element('hub-session-retry').hidden === false);
  assert.equal(grid.hidden, true); assert.equal(element('live-auth-form').hidden, true);
  assert.equal(calls.filter(value => value === 'snapshot').length, 0); assert.equal(socketCount, 0);
  element('hub-session-retry').onclick();
  await waitFor(() => element('start-button').textContent === 'Reconnect captions');
  assert.equal(grid.hidden, false); assert.equal(element('hub-logout').hidden, false);
  assert.equal(calls.filter(value => value === 'snapshot').length, 0, 'restoration does not restart polling');
  assert.equal(socketCount, 0, 'restoration does not reconnect the stream');
  assert.notEqual(capture.running, true, 'restoration does not restart capture');

  hubSession = false; dispatch({ type: 'wedding-hub-session-lock' }); hubSession = true; failRestoredPreflightAuth = true;
  dispatch({ type: 'wedding-hub-session-restored' });
  await waitFor(() => element('live-auth-form').hidden === false && element('live-auth-status').textContent.includes('caption operator session expired'));
  assert.equal(grid.hidden, true); assert.equal(element('hub-session-retry').hidden, true, 'caption auth failure uses the password form rather than a dead retry');
  assert.equal(calls.filter(value => value === 'snapshot').length, 0); assert.equal(socketCount, 0); assert.notEqual(capture.running, true);
});
