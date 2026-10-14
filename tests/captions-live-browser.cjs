/* Headless acceptance for the opt-in live captions UI. All providers are local fakes. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const http = require('node:http');

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for mocked browser action');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const vendorFake = `(() => {
  const channels = new Map(); let session = null, authListener = null;
  const lang = topic => topic.split(':').pop();
  window.__captionFake = { actions: [], realtimeTokens: [], channels,
    refresh(token) { session = { access_token: token }; authListener?.('TOKEN_REFRESHED', session); },
    emit(topic, event, payload) { channels.get(topic)?.handlers?.[event]?.({ payload }); } };
  window.supabase = { createClient() {
    const isGuest = location.pathname.endsWith('live-captions.html');
    if (!isGuest && !new URLSearchParams(location.search).has('login')) session = { access_token: 'admin-session' };
    return { auth: {
      async getSession() { return { data: { session } }; },
      async getUser() { return { data: { user: session ? { id: 'operator-user-1' } : null }, error: null }; },
      async signInAnonymously() { window.__captionFake.anonSignIns = (window.__captionFake.anonSignIns || 0) + 1; session = { access_token: 'guest-session' }; return { data: { session }, error: null }; },
      async signInWithOtp(value) { window.__captionFake.magicLink = value; return { data: {}, error: null }; },
      onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; }
    }, realtime: { setAuth(token) { window.__captionFake.realtimeTokens.push(token); } },
    channel(topic) { const entry = { topic, handlers: {} }; channels.set(topic, entry); return {
      on(_kind, filter, handler) { entry.handlers[filter.event] = handler; return this; },
      subscribe(callback) { setTimeout(() => {
        if (topic.startsWith('caption-guest:')) { callback('SUBSCRIBED'); return; }
        const language = lang(topic); entry.handlers['caption.batch']?.({ payload: window.__makeBatch(language, 2, 'Buffered ' + language + ' <img onerror=1>') });
        entry.handlers.heartbeat?.({ payload: { type: 'heartbeat', eventId: 'event-1', runId: 'run-1', modeGeneration: 1,
          channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', language, messageSeq: 2, status: 'live', publishedAt: new Date().toISOString() } });
        callback('SUBSCRIBED');
      }, 0); return this; }
    }; }, async removeChannel(channel) { channels.delete(channel.topic); }
    };
  } };
})();`;

const audioFake = `window.CaptionsAudio = {
  bytesToBase64() { return 'AAAAAAAA'; },
  Capture: class { constructor(options) { this.options = options; window.__capture = this; }
    async devices() { return [{ id: 'mic-1', label: 'Lectern microphone' }]; }
    async prepareDisplay() { this.shares = (this.shares || 0) + 1; if (window.__rejectShare) throw new Error('PC audio sharing cancelled'); this.prepared = true; }
    hasPreparedDisplay() { return Boolean(this.prepared); }
    discardPrepared() { this.prepared = false; }
    active() { return Boolean(this.running); }
    async start(source, id) { if (source === 'pc') { if (!this.prepared) throw new Error('Share PC audio first'); this.prepared = false; } else if (!id) throw new Error('Select a microphone first'); this.source = source; this.starts = (this.starts || 0) + 1; this.running = true; this.options.onState?.('capturing'); this.options.onMeter?.(.4); this.options.onFrame?.(new ArrayBuffer(2400), 1200); }
    async stop() { this.running = false; this.prepared = false; this.options.onMeter?.(0); this.options.onState?.('stopped'); }
  }
};`;

const { generateKeyPairSync, sign } = require('node:crypto');
const signing = generateKeyPairSync('ec', { namedCurve: 'P-256' }), publicKey = signing.publicKey.export({ format: 'jwk' });
// As the gateway signs: the channel it is published to, when it was signed, and the payload.
const envelope = (topic, payload, iat = Date.now()) => { const data = JSON.stringify({ topic, iat, payload }); return { data, sig: sign('sha256', Buffer.from(data), { key: signing.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') }; };
const guestTopic = language => `caption-guest:event-1:${language}:0123456789abcdef0123456789abcdef`;

async function main() {
  const modulePath = process.env.PUPPETEER_MODULE || path.resolve(__dirname, '../../Personal - wset-atlas/node_modules/puppeteer');
  const puppeteer = require(modulePath), root = path.resolve(__dirname, '..');
  const output = process.env.CAPTIONS_SCREENSHOT_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'captions-live-'));
  await fs.mkdir(output, { recursive: true });
  const actions = [], errors = [], contractErrors = [], storedScripts = [], preparedOperations = new Map(); let forceDisabled = false, failNextScripts = false, failNextPreparedSave = false, conflictNextPrepared = false, nextClearShowsNewer = false, rejectNextManualStart = false, nextScriptId = 1, preparedState = null, preparedCursor = -1, preparedStateRevision = 0, manualRunOpen = false, manualPreparedSelected = false, operatorAuthenticated = false, delayedAction = '', delayedSeen = '', releaseDelayed = null, losePreparedReply = '', currentRunId = 'run-1'; const allowed = new Set(['live-captions.html', 'live-captions-admin.html', 'live-captions.css',
    'live-captions-preview.js', 'live-captions-guest.js', 'live-captions-admin.js', 'live-captions-client.js', 'vendor/qr.js']);
  const batch = (language, seq = 1, text = 'Snapshot ' + language, selectedRunId = 'run-1') => ({ eventId: 'event-1', runId: selectedRunId, modeGeneration: 1,
    channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', messageSeq: seq, status: 'active', language, topic: 'topic:' + language,
    updates: [{ segmentId: 'segment-' + language, segmentOrder: 1, sourceRevision: 1, captionRevision: seq,
      status: 'final', origin: 'provider', text, language }] });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), file = url.pathname.slice(1);
    if (url.pathname === '/api/config.js') { res.setHeader('Content-Type', 'text/javascript'); res.end("window.SUPABASE_URL='http://fake.local';window.SUPABASE_ANON_KEY='public-fake';"); return; }
    if (url.pathname === '/vendor/supabase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(vendorFake); return; }
    if (file === 'live-captions-audio.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(audioFake); return; }
    if (url.pathname === '/api/captions.js') {
      let body = ''; for await (const chunk of req) body += chunk; const input = req.method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse(body || '{}'); actions.push(input);
      if (input.action === delayedAction) { delayedSeen = input.action; delayedAction = ''; await new Promise(resolve => { releaseDelayed = resolve; }); }
      if (failNextScripts && input.action === 'scripts') { failNextScripts = false; res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'SERVICE_UNAVAILABLE', message: 'Saved script storage is unavailable' } })); return; }
      if (failNextPreparedSave && input.action === 'prepared-cue') { failNextPreparedSave = false; res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'SERVICE_UNAVAILABLE', message: 'Caption save reply unavailable' } })); return; }
      if (conflictNextPrepared && input.action === 'next-prepared') { conflictNextPrepared = false; preparedStateRevision += 1; res.statusCode = 409; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'CONFLICT', message: 'Prepared run changed elsewhere' } })); return; }
      if (rejectNextManualStart && input.action === 'start' && input.mode === 'manual') { rejectNextManualStart = false; res.statusCode = 429; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'RATE_LIMITED', message: 'Try again' } })); return; }
      const disabled = forceDisabled && input.action === 'config'; if (disabled) forceDisabled = false; let data = {};
      if (input.action === 'config') { if (req.method !== 'GET') contractErrors.push('config_not_get'); data = { enabled: !disabled, guestLinksReady: !disabled, supportedLanguages: ['en', 'ja', 'zh-CN'] }; }
      else if (input.action === 'operatorStatus') data = { authenticated: operatorAuthenticated };
      else if (input.action === 'operatorLogin') { if (input.password !== 'test-operator') { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'INVALID_CREDENTIALS', message: 'Invalid password' } })); return; } operatorAuthenticated = true; data = { authenticated: true }; }
      else if (input.action === 'operatorLogout') { operatorAuthenticated = false; data = { authenticated: false }; }
      else if (input.action === 'preflight') data = { enabled: true, guestLinksReady: true, database: true, warnings: [] };
      else if (input.action === 'createEvent') data = { eventId: 'event-1' };
      else if (input.action === 'start') { if (input.mode === 'manual') { data = { eventId: 'event-1', runId: 'manual-run-1', mode: 'manual', alreadyOpen: manualRunOpen }; if (!manualRunOpen) manualPreparedSelected = false; manualRunOpen = true; } else { if (input.mode !== 'live') contractErrors.push('start_mode'); data = { eventId: 'event-1', runId: 'run-1', mode: 'live' }; } }
      else if (input.action === 'ticket') data = { token: 'single-use-ticket', runId: 'run-1', eventId: 'event-1' };
      else if (input.action === 'end') { if (input.runId === 'manual-run-1') { manualRunOpen = false; manualPreparedSelected = false; } data = { pendingRecognizedFinalSources: 0, pendingRecognizedFinalsChecked: true, pendingRecognizedFinalsTruncated: false }; }
      else if (input.action === 'stop') { if (input.runId === 'manual-run-1') { manualRunOpen = false; manualPreparedSelected = false; } data = {}; }
      else if (input.action === 'snapshot') data = input.runId === currentRunId
        ? batch(input.language, 1, `Snapshot ${input.language} ${currentRunId}`, currentRunId)
        : { ...batch(input.language, 1, `Snapshot ${input.language} ${input.runId}`, input.runId), currentRunId };
      else if (input.action === 'guestSnapshot') {
        if (req.headers.authorization) contractErrors.push('guest_sent_authorization');
        if (input.token !== 'invite-secret' || input.eventId !== 'event-1') { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'GUEST_LINK_INVALID', message: 'This guest link has expired or is not valid' } })); return; }
        const selected = input.runId || currentRunId; data = { ...batch(input.language, 1, `Snapshot ${input.language} ${selected}`, selected), currentRunId, guestTopic: guestTopic(input.language), publicKey, serverTime: Date.now() };
      }
      else if (input.action === 'manual') data = { segmentId: 'manual-segment', messageSeq: 3, delivery: { attempted: true, delivered: true, queued: false } };
      else if (input.action === 'invite') { if (!input.expiresAt || !Number.isSafeInteger(input.maxUses) || input.maxUses < 65) contractErrors.push('invite_contract'); data = { token: 'guest-invite', inviteId: 'invite-1' }; }
      else if (input.action === 'scripts') data = { scripts: storedScripts.map(item => ({ ...item })) };
      else if (input.action === 'script') { if (!input.script || typeof input.script !== 'object' || !input.script.title || !input.script.content || !Number.isSafeInteger(input.script.sequence)) contractErrors.push('script_contract');
        const existing = input.script.id ? storedScripts.find(item => item.id === input.script.id) : null;
        if (input.script.id && (!existing || input.script.revision !== existing.revision)) { res.statusCode = 409; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'CONFLICT', message: 'Script changed elsewhere' } })); return; }
        if (existing) Object.assign(existing, { title: input.script.title, content: input.script.content, sequence: input.script.sequence, revision: existing.revision + 1 });
        else storedScripts.push({ id: 'script-' + nextScriptId++, title: input.script.title, content: input.script.content, sequence: input.script.sequence, active: false, revision: 1 });
        data = { scripts: storedScripts.map(item => ({ ...item })) }; }
      else if (input.action === 'select-scripts') { if (!Array.isArray(input.scriptIds)) contractErrors.push('select_scripts_contract'); const selected = new Set(input.scriptIds || []); storedScripts.forEach(item => { item.active = selected.has(item.id); }); data = { scripts: storedScripts.map(item => ({ ...item })) }; }
      else if (input.action === 'prepared-cues') data = preparedState?.scriptId === input.scriptId ? preparedState : { scriptId: input.scriptId, scriptRevision: storedScripts.find(item => item.id === input.scriptId)?.revision || 1, status: 'empty', cues: [] };
      else if (input.action === 'prepare-script') { const script = storedScripts.find(item => item.id === input.scriptId); preparedState = { scriptId: input.scriptId, scriptRevision: script.revision, status: 'review_pending', done: true, progress: { completed: 2, total: 2 }, cues: [
        { id: 'cue-1', sequence: 0, sourceText: 'Welcome, family and friends.', en: 'Welcome, family and friends.', ja: 'ご家族、ご友人の皆様、ようこそ。', 'zh-CN': '欢迎各位家人和朋友。', status: 'review_pending', revision: 1 },
        { id: 'cue-2', sequence: 1, sourceText: 'Please enjoy the evening.', en: 'Please enjoy the evening.', ja: '今夜をお楽しみください。', 'zh-CN': '请尽情享受今晚。', status: 'review_pending', revision: 1 }
      ] }; data = preparedState; }
      else if (input.action === 'prepared-cue') { const cue = preparedState.cues.find(item => item.id === input.cue.id); Object.assign(cue, { en: input.cue.en, ja: input.cue.ja, 'zh-CN': input.cue['zh-CN'], status: 'review_pending', revision: cue.revision + 1 }); preparedState.status = 'review_pending'; data = preparedState; }
      else if (input.action === 'review-prepared-cue') { const cue = preparedState.cues.find(item => item.id === input.cueId); cue.status = 'ready'; cue.revision += 1; preparedState.status = preparedState.cues.every(item => item.status === 'ready') ? 'ready' : 'review_pending'; data = preparedState; }
      else if (input.action === 'select-prepared-script') { if (manualRunOpen && input.runId !== 'manual-run-1') contractErrors.push('prepared_select_run'); manualPreparedSelected = true; preparedCursor = -1; preparedStateRevision += 1; data = { scriptId: input.scriptId, scriptRevision: preparedState.scriptRevision, cursor: -1, stateRevision: preparedStateRevision, total: preparedState.cues.length, complete: false }; }
      else if (input.action === 'prepared-run') { if (!manualPreparedSelected) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'NOT_FOUND', message: 'Prepared run not selected' } })); return; } data = { scriptId: preparedState.scriptId, scriptRevision: preparedState.scriptRevision, cursor: preparedCursor, stateRevision: preparedStateRevision, total: preparedState.cues.length, complete: preparedCursor >= preparedState.cues.length - 1 && preparedCursor >= 0 }; }
      else if (input.action === 'next-prepared') { if (!input.operationId) contractErrors.push('next_operation_id'); if (preparedOperations.has(input.operationId)) data = { ...preparedOperations.get(input.operationId), replayed: true }; else { if (input.expectedScriptId !== preparedState.scriptId || input.expectedCursor !== preparedCursor || input.expectedScriptRevision !== preparedState.scriptRevision || input.expectedStateRevision !== preparedStateRevision) contractErrors.push('next_expected_state'); preparedCursor += 1; preparedStateRevision += 1; data = { scriptId: preparedState.scriptId, scriptRevision: preparedState.scriptRevision, cursor: preparedCursor, stateRevision: preparedStateRevision, currentCueId: preparedState.cues[preparedCursor]?.id, currentSegmentId: 'prepared-segment-' + preparedCursor, total: preparedState.cues.length, complete: preparedCursor >= preparedState.cues.length - 1, delivery: { attempted: true, delivered: true } }; preparedOperations.set(input.operationId, data); } }
      else if (input.action === 'publish-prepared-cue') { if (!input.operationId) contractErrors.push('publish_operation_id'); if (preparedOperations.has(input.operationId)) data = { ...preparedOperations.get(input.operationId), replayed: true }; else { if (input.expectedScriptId !== preparedState.scriptId || input.expectedCursor !== preparedCursor || input.expectedScriptRevision !== preparedState.scriptRevision || input.expectedStateRevision !== preparedStateRevision) contractErrors.push('publish_expected_state'); const index = preparedState.cues.findIndex(item => item.id === input.cueId); preparedCursor = index; preparedStateRevision += 1; data = { scriptId: preparedState.scriptId, scriptRevision: preparedState.scriptRevision, cursor: preparedCursor, stateRevision: preparedStateRevision, currentCueId: input.cueId, currentSegmentId: 'prepared-jump-' + preparedCursor, total: preparedState.cues.length, complete: preparedCursor >= preparedState.cues.length - 1, delivery: { attempted: true, delivered: true } }; preparedOperations.set(input.operationId, data); } }
      else if (input.action === 'clear-prepared') { if (!input.operationId) contractErrors.push('clear_operation_id'); if (preparedOperations.has(input.operationId)) data = { ...preparedOperations.get(input.operationId), replayed: true }; else { if (input.expectedScriptId !== preparedState.scriptId || input.expectedCursor !== preparedCursor || input.expectedScriptRevision !== preparedState.scriptRevision || input.expectedStateRevision !== preparedStateRevision) contractErrors.push('clear_expected_state'); preparedStateRevision += 1; data = { scriptId: preparedState.scriptId, scriptRevision: preparedState.scriptRevision, cursor: preparedCursor, stateRevision: preparedStateRevision, currentCueId: nextClearShowsNewer ? preparedState.cues[preparedCursor]?.id : null, currentSegmentId: nextClearShowsNewer ? 'newer-caption' : 'prepared-clear', total: preparedState.cues.length, complete: preparedCursor >= preparedState.cues.length - 1, cleared: !nextClearShowsNewer, replayed: nextClearShowsNewer, delivery: { attempted: true, delivered: true } }; nextClearShowsNewer = false; preparedOperations.set(input.operationId, data); } }
      else if (input.action === 'glossary') { if (!input.entry?.sourceTerm || !Object.hasOwn(input.entry, 'en') || !Object.hasOwn(input.entry, 'ja') || !Object.hasOwn(input.entry, 'zh-CN')) contractErrors.push('glossary_contract'); }
      if (losePreparedReply === input.action) { losePreparedReply = ''; res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'SERVICE_UNAVAILABLE', message: 'Committed, but the reply was lost' } })); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, requestId: 'fake-request', data })); return;
    }
    if (file === 'hub-caption-test.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe title="Caption operator" src="/live-captions-admin.html?hub=1&live=1"></iframe><script>window.__hubMessages=[];addEventListener('message',event=>{if(event.origin===location.origin)window.__hubMessages.push(event.data)})</script>`); return; }
    if (!allowed.has(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(await fs.readFile(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-first-run'] });
  const watchdog = setTimeout(() => browser.process()?.kill(), 90000);
  async function makePage() {
    const page = await browser.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      window.__makeBatch = (language, seq = 1, text = 'Snapshot ' + language) => ({ eventId: 'event-1', runId: 'run-1', modeGeneration: 1,
        channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', messageSeq: seq, status: 'active', language, topic: 'topic:' + language,
        updates: [{ segmentId: 'segment-' + language, segmentOrder: 1, sourceRevision: 1, captionRevision: seq,
          status: 'final', origin: 'provider', text, language }] });
      class FakeSocket {
        static OPEN = 1; constructor() { this.readyState = 0; this.sent = []; window.__socketCount = (window.__socketCount || 0) + 1; (window.__sockets ||= []).push(this); window.__lastSocket = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(value) { const message = JSON.parse(value); this.sent.push(message); (window.__socketMessages ||= []).push(message); if (message.type === 'auth') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', eventId: 'event-1', runId: 'run-1', modeGeneration: 1, channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', frameMs: 50, sampleRate: 24000 }) }), 0); if (message.type === 'drain') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'drained', reason: message.reason, withGap: Boolean(window.__drainDeliveryFailure), delivery: window.__drainDeliveryFailure ? { failed: 1, unresolvedFailed: 1 } : { failed: 0, unresolvedFailed: 0 } }) }), 20); }
        close() { this.readyState = 3; this.onclose?.(); }
        emit(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
      }
      window.WebSocket = FakeSocket;
    });
    return page;
  }
  try {
    for (const width of [344, 390, 744, 1280]) {
      const page = await makePage(); await page.setViewport({ width, height: 900 });
      await page.goto(`${origin}/live-captions-admin.html?live=1&login=1`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#live-auth-panel:not([hidden])');
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
        small: [...document.querySelectorAll('button,input,a')].filter(item => item.getClientRects().length && item.getBoundingClientRect().height < 43.9).map(item => item.id) }));
      assert(layout.scrollWidth <= width + 1, `live admin overflow at ${width}`); assert.deepEqual(layout.small, [], `small live target at ${width}`);
      if (width === 390 || width === 1280) await page.screenshot({ path: path.join(output, `live-admin-auth-${width}.png`), fullPage: true });
      await page.close();
    }
    forceDisabled = true; const disabled = await makePage(); await disabled.goto(`${origin}/live-captions-admin.html?live=1&disabled=1`, { waitUntil: 'networkidle0' });
    assert.equal(await disabled.$eval('#start-button', item => item.disabled), true); assert.match(await disabled.$eval('#status-text', item => item.textContent), /disabled/); await disabled.close();

    const login = await makePage(); await login.goto(`${origin}/live-captions-admin.html?live=1&login=1`, { waitUntil: 'networkidle0' });
    await login.type('#live-auth-email', 'operator@example.test'); await login.click('#live-auth-submit');
    await login.waitForFunction(() => window.__captionFake.magicLink?.email === 'operator@example.test'); await login.close();

    const scriptsPage = await makePage(); await scriptsPage.goto(`${origin}/live-captions-admin.html?live=1`, { waitUntil: 'networkidle0' });
    await scriptsPage.waitForFunction(() => !document.getElementById('prepare-event').disabled); const scriptActionStart = actions.length; delayedSeen = ''; delayedAction = 'createEvent'; await scriptsPage.click('#prepare-event'); await waitFor(() => delayedSeen === 'createEvent');
    assert.equal(await scriptsPage.$eval('#start-button', item => item.disabled), true, 'Start is fenced while event preparation is pending'); await scriptsPage.evaluate(() => document.getElementById('start-button').click()); assert.equal(actions.slice(scriptActionStart).some(item => item.action === 'start'), false); releaseDelayed();
    await scriptsPage.waitForFunction(() => document.getElementById('current-event-id').textContent === 'event-1'
      && !document.getElementById('script-text').disabled && !document.getElementById('save-script').disabled);
    await scriptsPage.type('#script-text', 'Welcome everyone.'); const firstSaveStart = actions.length; await scriptsPage.evaluate(() => { const button = document.getElementById('save-script'); button.click(); button.click(); });
    await scriptsPage.waitForFunction(() => document.querySelectorAll('.script-item').length === 1);
    assert.equal(actions.slice(firstSaveStart).filter(item => item.action === 'script').length, 1, 'double click creates one saved script');
    assert.match(await scriptsPage.$eval('#script-selection-summary', item => item.textContent), /No script/); assert.equal(actions.slice(scriptActionStart).some(item => item.action === 'start'), false, 'scripts preload before audio Start');
    await scriptsPage.click('.script-item .button'); await scriptsPage.waitForFunction(() => document.getElementById('script-editor-title').textContent.includes('Edit'));
    await scriptsPage.evaluate(() => { document.getElementById('script-title').value = 'Welcome remarks'; document.getElementById('script-text').value = 'Welcome, family and friends.'; }); await scriptsPage.click('#save-script');
    await scriptsPage.waitForFunction(() => document.querySelector('.script-details strong')?.textContent === 'Welcome remarks');
    const editCall = actions.filter(item => item.action === 'script').at(-1); assert.deepEqual({ id: editCall.script.id, revision: editCall.script.revision }, { id: 'script-1', revision: 1 }, 'edits retain server id and revision');
    await scriptsPage.click('.script-item .button'); storedScripts[0].revision += 1; await scriptsPage.click('#use-no-script'); await scriptsPage.waitForFunction(() => document.getElementById('content-tools-status').textContent.includes('No script'));
    await scriptsPage.evaluate(() => { document.getElementById('script-text').value = 'A stale edit must not overwrite newer content.'; }); await scriptsPage.click('#save-script');
    await scriptsPage.waitForFunction(() => document.getElementById('content-tools-status').textContent.includes('changed elsewhere')); assert.equal(actions.filter(item => item.action === 'script').at(-1).script.revision, 2, 'edit keeps the revision captured when Edit was pressed');
    await scriptsPage.click('#cancel-script-edit'); await scriptsPage.click('#open-event'); await scriptsPage.waitForFunction(() => document.getElementById('event-status').textContent.includes('Event opened'));
    await scriptsPage.evaluate(() => { document.getElementById('script-title').value = 'Dinner remarks'; document.getElementById('script-sequence').value = '1'; document.getElementById('script-text').value = 'Dinner will begin shortly.'; }); await scriptsPage.click('#save-script');
    await scriptsPage.waitForFunction(() => document.querySelectorAll('.script-item').length === 2);
    await scriptsPage.$$eval('#script-list input[type="checkbox"]', items => items.forEach(item => { item.checked = true; })); const selectStart = actions.length; await scriptsPage.evaluate(() => { const button = document.getElementById('use-selected-scripts'); button.click(); button.click(); });
    await scriptsPage.waitForFunction(() => document.getElementById('script-selection-summary').textContent.includes('Dinner remarks'));
    assert.equal(actions.slice(selectStart).filter(item => item.action === 'select-scripts').length, 1, 'double click applies selection once');
    await scriptsPage.click('#use-no-script'); await scriptsPage.waitForFunction(() => document.getElementById('script-selection-summary').textContent.includes('No script'));
    await scriptsPage.$eval('#script-list input[type="checkbox"]', item => { item.checked = true; }); await scriptsPage.click('#use-selected-scripts');
    await scriptsPage.waitForFunction(() => document.getElementById('script-selection-summary').textContent.includes('Welcome remarks'));
    await scriptsPage.$$eval('.script-item:first-child .script-actions button', items => items.find(item => item.textContent === 'Open captions').click());
    await scriptsPage.waitForFunction(() => !document.getElementById('prepared-workspace').hidden && document.getElementById('prepared-readiness').textContent.includes('Not prepared'));
    const prepareActionStart = actions.length; await scriptsPage.click('#prepare-translations'); await scriptsPage.waitForFunction(() => document.querySelectorAll('.prepared-cue').length === 2);
    assert.equal(actions.slice(prepareActionStart).filter(item => item.action === 'prepare-script').length, 1, 'one explicit Prepare click drives the fake one-step translation result');
    assert.match(await scriptsPage.$eval('#prepared-readiness', item => item.textContent), /review/); assert.equal(await scriptsPage.$eval('#start-prepared', item => item.disabled), true, 'generated captions cannot start before review');
    await scriptsPage.$$eval('.prepared-cue textarea[data-language="en"]', items => { items[0].value = 'Welcome, everyone.'; items[0].dispatchEvent(new Event('input', { bubbles: true })); items[1].value = 'Please enjoy tonight.'; items[1].dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await scriptsPage.$eval('#start-prepared', item => item.disabled), true, 'unsaved caption edits block prepared mode'); assert.deepEqual(await scriptsPage.$$eval('[data-cue-review]', items => items.map(item => item.disabled)), [true, true], 'dirty generated captions cannot be reviewed');
    failNextPreparedSave = true; await scriptsPage.click('.prepared-cue [data-cue-save]'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('Your edits are still here'));
    assert.equal(await scriptsPage.$eval('.prepared-cue:first-child textarea[data-language="en"]', item => item.value), 'Welcome, everyone.', 'an uncertain save preserves the attempted cue edit'); assert.equal(await scriptsPage.$eval('.prepared-cue:first-child', item => item.dataset.dirty), 'true');
    await scriptsPage.click('.prepared-cue [data-cue-save]'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('saved'));
    assert.equal(await scriptsPage.$eval('.prepared-cue:nth-child(2) textarea[data-language="en"]', item => item.value), 'Please enjoy tonight.', 'saving one cue preserves another cue draft');
    assert.equal(await scriptsPage.$eval('.prepared-cue:nth-child(2)', item => item.dataset.dirty), 'true');
    await scriptsPage.click('.prepared-cue [data-cue-review]'); await scriptsPage.waitForFunction(() => document.querySelectorAll('.prepared-cue')[0].querySelector('.prepared-cue-status').textContent.includes('Reviewed'));
    assert.equal(await scriptsPage.$eval('.prepared-cue:nth-child(2) textarea[data-language="en"]', item => item.value), 'Please enjoy tonight.', 'reviewing one cue preserves another cue draft');
    await scriptsPage.click('.prepared-cue:nth-child(2) [data-cue-save]'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('saved'));
    await scriptsPage.click('.prepared-cue:nth-child(2) [data-cue-review]'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-readiness').textContent.includes('Reviewed and ready'));
    assert.deepEqual(await scriptsPage.$$eval('[data-cue-review]', items => items.map(item => item.disabled)), [true, true], 'reviewed buttons remain disabled after rerender');
    delayedSeen = ''; delayedAction = 'select-prepared-script'; const cancelledPreparedStart = actions.length; await scriptsPage.click('#start-prepared'); await waitFor(() => delayedSeen === 'select-prepared-script'); await scriptsPage.click('#stop-button'); await waitFor(() => actions.slice(cancelledPreparedStart).some(item => item.action === 'stop' && item.runId === 'manual-run-1')); releaseDelayed();
    await scriptsPage.waitForFunction(() => document.getElementById('status-text').textContent.includes('stopped')); await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(await scriptsPage.$eval('#next-prepared', item => item.disabled), true, 'late prepared selection cannot resurrect controls after Stop');
    const preparedLiveStart = actions.length; await scriptsPage.click('#start-prepared'); await scriptsPage.waitForFunction(() => !document.getElementById('next-prepared').disabled);
    assert.equal(actions.slice(preparedLiveStart).some(item => item.action === 'ticket'), false, 'prepared captions never open an audio uplink'); assert.equal(await scriptsPage.evaluate(() => Boolean(window.__capture?.running)), false, 'prepared captions do not start capture');
    const manualLayout = await scriptsPage.evaluate(() => ({ editorDisplay: getComputedStyle(document.querySelector('.prepared-language-grid')).display, toolbarPosition: getComputedStyle(document.querySelector('.prepared-live-controls')).position, toolbarBeforeCues: Boolean(document.querySelector('.prepared-live-controls').compareDocumentPosition(document.getElementById('prepared-cue-list')) & Node.DOCUMENT_POSITION_FOLLOWING), sourceVisible: document.querySelector('.prepared-source').getClientRects().length > 0 })); assert.deepEqual(manualLayout, { editorDisplay: 'none', toolbarPosition: 'sticky', toolbarBeforeCues: true, sourceVisible: true }, 'manual playback compacts cues and keeps its toolbar above the source list');
    await scriptsPage.$$eval('.script-item:nth-child(2) .script-actions button', items => items.find(item => item.textContent === 'Open captions').click()); await scriptsPage.waitForFunction(() => document.getElementById('prepared-script-title').textContent.includes('Dinner remarks'));
    assert.equal(await scriptsPage.$eval('#next-prepared', item => item.disabled), true, 'viewing another speech cannot publish the selected speech under the wrong title');
    await scriptsPage.$$eval('.script-item:first-child .script-actions button', items => items.find(item => item.textContent === 'Open captions').click()); await scriptsPage.waitForFunction(() => !document.getElementById('next-prepared').disabled);
    for (const width of [344, 390, 744, 1280]) { await scriptsPage.setViewport({ width, height: 1000 }); const layout = await scriptsPage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, small: [...document.querySelectorAll('#prepared-captions button, #prepared-captions textarea')].filter(item => item.getClientRects().length && item.getBoundingClientRect().height < 43.9).map(item => item.id || item.textContent) })); assert(layout.scrollWidth <= width + 1, `prepared controls overflow at ${width}`); assert.deepEqual(layout.small, [], `small prepared target at ${width}`); if (width === 390 || width === 1280) await scriptsPage.screenshot({ path: path.join(output, `prepared-manual-${width}.png`), fullPage: true }); }
    await scriptsPage.click('.prepared-cue [data-cue-publish]'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-live-position').textContent.includes('Showing caption 1 of 2'));
    conflictNextPrepared = true; const conflictStart = actions.length; await scriptsPage.click('#next-prepared'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('position were refreshed')); assert.equal(await scriptsPage.$eval('#next-prepared', item => item.disabled), false, 'a stale prepared action refreshes run state for a new explicit attempt'); const conflictedNext = actions.slice(conflictStart).find(item => item.action === 'next-prepared');
    losePreparedReply = 'next-prepared'; const nextStart = actions.length; await scriptsPage.click('#next-prepared'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('reply was lost')); await scriptsPage.click('#next-prepared'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-live-position').textContent.includes('At final caption 2 of 2'));
    const retriedNext = actions.slice(nextStart).filter(item => item.action === 'next-prepared'); assert.equal(retriedNext.length, 2); assert.notEqual(conflictedNext.operationId, retriedNext[0].operationId, 'a conflict requires a new explicit operation'); assert.equal(retriedNext[0].operationId, retriedNext[1].operationId, 'lost Next reply retries the same operation'); assert.deepEqual(retriedNext[0], retriedNext[1], 'lost Next reply reuses the same expected run state'); assert.equal(preparedCursor, 1, 'lost Next reply advances the backend cursor only once');
    await scriptsPage.click('#clear-prepared'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('Guest captions cleared'));
    nextClearShowsNewer = true; await scriptsPage.click('#clear-prepared'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('newer caption is current'));
    const preparedOps = actions.filter(item => ['publish-prepared-cue', 'next-prepared', 'clear-prepared'].includes(item.action)); assert(preparedOps.every(item => typeof item.operationId === 'string' && item.operationId.length > 10)); assert.equal(new Set(preparedOps.map(item => item.operationId)).size, preparedOps.length - 1, 'each deliberate publish action gets a fresh operation id while retry keeps its id');
    await scriptsPage.reload({ waitUntil: 'networkidle0' }); await scriptsPage.waitForFunction(() => document.getElementById('script-selection-summary').textContent.includes('Welcome remarks')); await scriptsPage.$$eval('.script-item:first-child .script-actions button', items => items.find(item => item.textContent === 'Open captions').click()); await scriptsPage.waitForFunction(() => document.getElementById('prepared-readiness').textContent.includes('Reviewed and ready')); await scriptsPage.click('#start-prepared');
    await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('Restored the open')); assert.match(await scriptsPage.$eval('#prepared-live-position', item => item.textContent), /At final caption 2 of 2/); assert.equal(await scriptsPage.$eval('#next-prepared', item => item.disabled), true, 'restored final run does not offer a nonexistent next caption');
    await scriptsPage.click('#end-prepared'); await scriptsPage.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('Live audio can now be started'));
    const local = await scriptsPage.evaluate(() => Object.fromEntries(Object.entries(localStorage))); assert.deepEqual(local, { 'captions:operator-event:operator-user-1': 'event-1' }, 'browser stores only the signed-in user scoped event id');
    delayedSeen = ''; delayedAction = 'scripts'; await scriptsPage.reload({ waitUntil: 'domcontentloaded' }); await waitFor(() => delayedSeen === 'scripts'); assert.equal(await scriptsPage.$eval('#start-button', item => item.disabled), true, 'Start is fenced while event restore is pending'); releaseDelayed(); await scriptsPage.waitForFunction(() => document.getElementById('script-selection-summary').textContent.includes('Welcome remarks'));
    const createsBeforeFailedRestore = actions.filter(item => item.action === 'createEvent').length; failNextScripts = true; await scriptsPage.reload({ waitUntil: 'networkidle0' });
    await scriptsPage.waitForFunction(() => document.getElementById('event-status').textContent.includes('No new event was created'));
    assert.equal(actions.filter(item => item.action === 'createEvent').length, createsBeforeFailedRestore, 'transient restore failure never silently creates a new event');
    assert.equal(await scriptsPage.$eval('#start-button', item => item.disabled), false, 'saved-script storage failure does not block microphone captions');
    await scriptsPage.reload({ waitUntil: 'networkidle0' }); await scriptsPage.waitForFunction(() => document.getElementById('script-selection-summary').textContent.includes('Welcome remarks')); await scriptsPage.close();

    const hubPage = await makePage(); await hubPage.goto(`${origin}/hub-caption-test.html`, { waitUntil: 'networkidle0' }); let hubFrame = hubPage.frames().find(frame => frame.url().includes('live-captions-admin.html?hub=1'));
    assert(hubFrame, 'hub operator iframe loaded'); await hubFrame.waitForSelector('#live-auth-panel:not([hidden])'); assert.equal(await hubFrame.$eval('.operator-grid', item => item.hidden), true, 'hub controls begin behind the password gate');
    await hubFrame.type('#live-auth-password', 'test-operator'); await hubFrame.click('#live-auth-submit'); await hubFrame.waitForFunction(() => !document.querySelector('.operator-grid').hidden && !document.getElementById('open-event').disabled);
    await hubFrame.$eval('#open-event-id', item => { item.value = 'event-1'; }); await hubFrame.click('#open-event'); await hubFrame.waitForFunction(() => document.querySelectorAll('.script-item').length === 2);
    await hubFrame.$$eval('.script-item:first-child .script-actions button', items => items.find(item => item.textContent === 'Open captions').click()); await hubFrame.waitForFunction(() => document.getElementById('prepared-readiness').textContent.includes('Reviewed and ready'));
    delayedSeen = ''; delayedAction = 'start'; losePreparedReply = 'start'; await hubFrame.click('#start-prepared'); await waitFor(() => delayedSeen === 'start'); await hubPage.waitForFunction(() => window.__hubMessages.at(-1)?.type === 'wedding-hub-caption-state' && window.__hubMessages.at(-1).active === true); assert.equal(await hubFrame.$eval('#hub-logout', item => item.disabled), true, 'hub logout is locked while a manual run is being allocated'); releaseDelayed();
    await hubFrame.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('reply was lost')); assert.equal(await hubFrame.$eval('#hub-logout', item => item.disabled), true, 'ambiguous manual start keeps hub logout locked'); assert.equal(await hubFrame.$eval('#stop-button', item => item.disabled), true, 'an unknown run cannot be falsely stopped without its id'); assert.match(await hubFrame.$eval('#start-prepared', item => item.textContent), /Retry start/); rejectNextManualStart = true; await hubFrame.click('#start-prepared');
    await hubFrame.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('still unresolved')); assert.equal(await hubFrame.$eval('#hub-logout', item => item.disabled), true, 'a refused retry cannot clear the earlier unknown start'); assert.equal(await hubFrame.$eval('#stop-button', item => item.disabled), true, 'a refused retry still cannot stop an unknown run'); assert.match(await hubFrame.$eval('#start-prepared', item => item.textContent), /Retry start/); await hubFrame.evaluate(() => document.getElementById('hub-logout').onclick()); assert.equal(actions.filter(item => item.action === 'operatorLogout').length, 0, 'programmatic logout is fenced while a manual start remains unresolved'); await hubFrame.click('#start-prepared');
    await hubFrame.waitForFunction(() => !document.getElementById('next-prepared').disabled); await hubPage.waitForFunction(() => window.__hubMessages.some(message => message?.type === 'wedding-hub-caption-state' && message.active === true));
    assert.equal(await hubFrame.evaluate(() => Boolean(window.__capture?.running)), false, 'hub prepared mode does not start audio capture');
    for (const width of [344, 390, 744, 1280]) { await hubPage.setViewport({ width, height: 1000 }); hubFrame = hubPage.frames().find(frame => frame.url().includes('live-captions-admin.html?hub=1')); const layout = await hubFrame.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, small: [...document.querySelectorAll('#prepared-captions button, #prepared-captions textarea')].filter(item => item.getClientRects().length && item.getBoundingClientRect().height < 43.9).map(item => item.id || item.textContent) })); assert(layout.scrollWidth <= layout.clientWidth + 1, `hub prepared controls overflow at ${width}`); assert.deepEqual(layout.small, [], `small hub prepared target at ${width}`); }
    await hubFrame.evaluate(() => parent.postMessage({ type: 'test-dispatch-lock' }, location.origin)); await hubPage.evaluate(originValue => document.querySelector('iframe').contentWindow.postMessage({ type: 'wedding-hub-session-lock' }, originValue), origin); await hubFrame.waitForFunction(() => document.querySelector('.operator-grid').hidden && !document.getElementById('live-auth-panel').hidden);
    await hubPage.evaluate(originValue => document.querySelector('iframe').contentWindow.postMessage({ type: 'wedding-hub-session-restored' }, originValue), origin); await hubFrame.waitForFunction(() => !document.querySelector('.operator-grid').hidden && !document.getElementById('next-prepared').disabled);
    assert.equal(await hubFrame.$eval('#start-button', item => item.disabled), true, 'restoring a prepared run never exposes live-audio reconnect'); const startCountAfterRestore = actions.filter(item => item.action === 'start').length; await hubFrame.evaluate(() => document.getElementById('start-button').onclick()); assert.equal(actions.filter(item => item.action === 'start').length, startCountAfterRestore, 'programmatic Start cannot convert a prepared run to live audio');
    assert.match(await hubFrame.$eval('#status-text', item => item.textContent), /Prepared captions are open/); const hubLocal = await hubFrame.evaluate(() => Object.fromEntries(Object.entries(localStorage))); assert.equal(hubLocal['captions:operator-event:hub-operator'], 'event-1'); assert(Object.keys(hubLocal).every(key => key.startsWith('captions:operator-event:')) && Object.values(hubLocal).every(value => value === 'event-1'), 'caption storage contains only scoped event ids');
    const parentMessageCount = await hubPage.evaluate(() => window.__hubMessages.length); await Promise.all([hubFrame.waitForNavigation({ waitUntil: 'networkidle0' }), hubFrame.evaluate(() => location.reload())]); await hubFrame.waitForFunction(() => document.querySelectorAll('.script-item').length === 2); await hubFrame.$$eval('.script-item:first-child .script-actions button', items => items.find(item => item.textContent === 'Open captions').click()); await hubFrame.waitForFunction(() => document.getElementById('prepared-readiness').textContent.includes('Reviewed and ready')); await hubFrame.click('#start-prepared');
    await hubFrame.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('Restored the open')); assert.equal(await hubFrame.$eval('#start-button', item => item.disabled), true, 'hub reload restores an existing prepared run without exposing live-audio reconnect'); assert.equal(await hubFrame.$eval('#end-prepared', item => item.disabled), false, 'restored hub prepared run can still be ended'); await hubPage.waitForFunction(index => window.__hubMessages.slice(index).some(message => message?.type === 'wedding-hub-caption-state' && message.active === true), {}, parentMessageCount);
    await hubFrame.click('#end-prepared'); await hubFrame.waitForFunction(() => document.getElementById('prepared-status').textContent.includes('Live audio can now be started')); await hubPage.waitForFunction(() => window.__hubMessages.at(-1)?.type === 'wedding-hub-caption-state' && window.__hubMessages.at(-1).active === false); await hubPage.close();

    const cancelledStart = await makePage(); await cancelledStart.goto(`${origin}/live-captions-admin.html?live=1`, { waitUntil: 'networkidle0' });
    await cancelledStart.waitForFunction(() => !document.getElementById('audio-device').disabled); await cancelledStart.select('#audio-device', 'mic-1');
    delayedSeen = ''; delayedAction = 'start'; const startActionIndex = actions.length; await cancelledStart.click('#start-button'); await waitFor(() => delayedSeen === 'start');
    await cancelledStart.click('#stop-button'); releaseDelayed(); await waitFor(() => actions.slice(startActionIndex).some(value => value.action === 'stop' && value.runId === 'run-1'));
    await cancelledStart.waitForFunction(() => document.getElementById('status-text').textContent.includes('stopped'));
    assert.equal(await cancelledStart.evaluate(() => window.__socketCount || 0), 0, 'late Start must not open a WebSocket');
    assert.equal(await cancelledStart.evaluate(() => Boolean(window.__capture?.running)), false, 'late Start must not restart capture'); await cancelledStart.close();

    const cancelledResume = await makePage(); await cancelledResume.goto(`${origin}/live-captions-admin.html?live=1`, { waitUntil: 'networkidle0' });
    await cancelledResume.waitForFunction(() => !document.getElementById('audio-device').disabled); await cancelledResume.select('#audio-device', 'mic-1'); await cancelledResume.click('#start-button');
    await cancelledResume.waitForFunction(() => document.getElementById('status-text').textContent.includes('connected')); await cancelledResume.click('#pause-button'); await cancelledResume.waitForFunction(() => document.getElementById('status-text').textContent.includes('paused'));
    const socketsBeforeResume = await cancelledResume.evaluate(() => window.__socketCount || 0); delayedSeen = ''; delayedAction = 'resume'; const resumeActionIndex = actions.length;
    await cancelledResume.click('#resume-button'); await waitFor(() => delayedSeen === 'resume'); await cancelledResume.click('#stop-button'); await waitFor(() => actions.slice(resumeActionIndex).some(value => value.action === 'stop'));
    releaseDelayed(); await waitFor(() => actions.slice(resumeActionIndex).filter(value => value.action === 'stop').length >= 2);
    assert.equal(await cancelledResume.evaluate(() => window.__socketCount || 0), socketsBeforeResume, 'late Resume must not open another WebSocket');
    assert.equal(await cancelledResume.evaluate(() => Boolean(window.__capture?.running)), false); assert.match(await cancelledResume.$eval('#status-text', item => item.textContent), /stopped/); await cancelledResume.close();

    const admin = await makePage(); await admin.goto(`${origin}/live-captions-admin.html?live=1`, { waitUntil: 'networkidle0' });
    await admin.waitForFunction(() => !document.getElementById('audio-device').disabled); await admin.select('#audio-device', 'mic-1'); await admin.click('#start-button');
    await admin.waitForFunction(() => window.__socketMessages?.some(value => value.type === 'audio'));
    const audioMessage = await admin.evaluate(() => window.__socketMessages.find(value => value.type === 'audio'));
    assert.deepEqual({ sequence: audioMessage.sequence, sampleOffset: audioMessage.sampleOffset }, { sequence: 0, sampleOffset: 0 }); assert(audioMessage.captureEpoch);
    await admin.evaluate(() => window.__lastSocket.emit({ type: 'review', reviewId: 'review-1', rawText: 'raw <b>', proposedText: 'proposed <img>', matchedCueIds: [2, 3], reviewable: true }));
    assert.equal(await admin.$eval('#review-proposed', item => item.children.length), 0); await admin.click('#review-approve');
    await admin.type('#manual-en', 'Manual <script>'); await admin.type('#manual-ja', '手動'); await admin.type('#manual-zh-cn', '手动'); await admin.click('#manual-submit'); await admin.waitForFunction(() => document.getElementById('manual-message').textContent.includes('saved'));
    await admin.type('#glossary-source', '新人'); await admin.type('#glossary-en', 'newlyweds'); await admin.type('#glossary-ja', '新郎新婦'); await admin.type('#glossary-zh-cn', '新人'); await admin.click('#save-glossary');
    await admin.type('#script-text', 'Welcome everyone.'); await admin.click('#save-script'); await admin.click('#create-invite'); await admin.waitForFunction(() => document.getElementById('invite-output').textContent.includes('guest-invite'));
    const invite = await admin.evaluate(() => ({ qr: document.querySelector('#invite-output img.invite-qr')?.getAttribute('src') || '', save: document.querySelector('#invite-output a[download]')?.textContent || '',
      link: document.querySelector('#invite-output .invite-link')?.textContent || '', maxUsesHidden: document.getElementById('invite-max-uses').hidden, button: document.getElementById('create-invite').textContent }));
    assert.match(invite.qr, /^data:image\/svg\+xml/, 'the guest link is shown as a QR code'); assert.equal(invite.save, 'Save QR code'); assert.equal(invite.button, 'Create guest QR code');
    assert.match(invite.link, /live-captions\.html\?live=1&event=event-1#token=guest-invite$/); assert.equal(invite.maxUsesHidden, true);
    await admin.click('#pause-button'); await admin.waitForFunction(() => document.getElementById('status-text').textContent.includes('paused')); assert.equal(await admin.evaluate(() => window.__capture.running), false);
    assert.equal(await admin.evaluate(() => window.__socketMessages.some(value => value.type === 'drain' && value.reason === 'pause')), true);
    assert.match(await admin.$eval('#status-text', item => item.textContent), /last captured words completed/);
    await admin.click('#resume-button'); await admin.waitForFunction(() => document.getElementById('status-text').textContent.includes('connected'));
    await admin.evaluate(() => { window.__drainDeliveryFailure = true; }); await admin.click('#end-button'); await admin.waitForFunction(() => document.getElementById('status-text').textContent.includes('pending failures'));
    assert.doesNotMatch(await admin.$eval('#status-text', item => item.textContent), /final-audio gap/);
    assert.equal(await admin.evaluate(() => window.__socketMessages.some(value => value.type === 'drain' && value.reason === 'end')), true);
    await admin.click('#start-button'); await admin.waitForFunction(() => document.getElementById('status-text').textContent.includes('connected'));
    const rotationBefore = await admin.evaluate(() => ({ sockets: window.__socketCount, starts: window.__capture.starts }));
    await admin.evaluate(() => { const old = window.__lastSocket; old.emit({ type: 'status', status: 'rotation.preparing' }); for (let index = 0; index < 62; index += 1) window.__capture.options.onFrame(new ArrayBuffer(2400), 1200); old.emit({ type: 'rotate', reason: 'function_duration' }); });
    await admin.waitForFunction(expected => window.__socketCount === expected + 1 && window.__lastSocket.sent.filter(value => value.type === 'audio').length === 60, {}, rotationBefore.sockets);
    const handoff = await admin.evaluate(() => ({ starts: window.__capture.starts, running: window.__capture.running,
      replay: window.__socketMessages.filter(value => value.type === 'audio').slice(-60).map(value => ({ sequence: value.sequence, sampleOffset: value.sampleOffset })) }));
    assert.equal(handoff.starts, rotationBefore.starts, 'scheduled handoff reuses the selected microphone'); assert.equal(handoff.running, true); assert.equal(handoff.replay.length, 60); assert.deepEqual(handoff.replay[0], { sequence: 2, sampleOffset: 2400 });
    delayedSeen = ''; delayedAction = 'ticket'; const socketsBeforeStoppedHandoff = await admin.evaluate(() => window.__socketCount), stoppedHandoffActionIndex = actions.length;
    await admin.evaluate(() => { window.__lastSocket.emit({ type: 'status', status: 'rotation.preparing' }); window.__capture.options.onFrame(new ArrayBuffer(2400), 1200); window.__lastSocket.emit({ type: 'rotate', reason: 'function_duration' }); });
    await waitFor(() => delayedSeen === 'ticket'); await admin.click('#stop-button'); releaseDelayed();
    await waitFor(() => actions.slice(stoppedHandoffActionIndex).some(value => value.action === 'stop' && value.runId === 'run-1'));
    await admin.waitForFunction(() => document.getElementById('status-dot').dataset.state === 'ended' && document.getElementById('status-text').textContent.includes('stopped'));
    // The released ticket reaches the page independently of the stop reply; let it land before asserting that nothing follows it.
    await admin.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
    const stoppedHandoff = await admin.evaluate(() => { const audioBefore = window.__socketMessages.filter(value => value.type === 'audio').length; window.__capture.options.onFrame(new ArrayBuffer(2400), 1200);
      return { sockets: window.__socketCount, running: Boolean(window.__capture.running), audioBefore, audioAfter: window.__socketMessages.filter(value => value.type === 'audio').length }; });
    assert.equal(stoppedHandoff.sockets, socketsBeforeStoppedHandoff, 'Stop during handoff must not open a late socket');
    assert.equal(stoppedHandoff.running, false, 'Stop during handoff must cut capture'); assert.equal(stoppedHandoff.audioAfter, stoppedHandoff.audioBefore, 'Stop during handoff must not upload later frames');
    await admin.click('#start-button'); await admin.waitForFunction(expected => window.__socketCount === expected + 1 && document.getElementById('status-text').textContent.includes('connected'), {}, socketsBeforeStoppedHandoff);
    assert.deepEqual(await admin.evaluate(() => window.__lastSocket.sent.filter(value => value.type === 'audio').map(value => ({ sequence: value.sequence, sampleOffset: value.sampleOffset }))), [{ sequence: 0, sampleOffset: 0 }], 'the frame buffered for the stopped handoff must not be replayed after a restart');
    await admin.close();

    const detached = await makePage(); await detached.setViewport({ width: 344, height: 900 }); await detached.goto(`${origin}/live-captions-admin.html?live=1`, { waitUntil: 'networkidle0' });
    await detached.waitForFunction(() => !document.getElementById('audio-device').disabled); await detached.select('#audio-device', 'mic-1'); await detached.click('#start-button');
    await detached.waitForFunction(() => document.getElementById('status-text').textContent.includes('connected'));
    const socketsBeforeDetach = await detached.evaluate(() => { window.__capture.options.onDeviceEnded(); return window.__socketCount; });
    await detached.waitForFunction(() => document.getElementById('start-button').textContent === 'Reconnect captions' && !document.getElementById('stop-button').disabled);
    const detachedLayout = await detached.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, status: document.getElementById('status-text').textContent,
      small: [...document.querySelectorAll('button,input,select,textarea,a')].filter(item => item.getClientRects().length && item.getBoundingClientRect().height < 43.9).map(item => item.id || item.tagName) }));
    assert.match(detachedLayout.status, /microphone disconnected/); assert(detachedLayout.scrollWidth <= 345, 'detached operator state overflows at 344'); assert.deepEqual(detachedLayout.small, [], 'small live control at 344');
    await detached.screenshot({ path: path.join(output, 'live-admin-detached-344.png'), fullPage: true });
    await detached.click('#start-button'); await detached.waitForFunction(expected => window.__socketCount === expected + 1 && document.getElementById('status-text').textContent.includes('connected'), {}, socketsBeforeDetach);
    assert((await detached.evaluate(() => window.__lastSocket.sent.find(value => value.type === 'audio').sequence)) >= 1, 'reattaching declares the audio lost while detached');
    await detached.click('#stop-button'); await detached.waitForFunction(() => document.getElementById('status-text').textContent.includes('stopped')); await detached.close();

    const pc = await makePage(); await pc.goto(`${origin}/live-captions-admin.html?live=1`, { waitUntil: 'networkidle0' });
    await pc.waitForFunction(() => !document.getElementById('audio-source').disabled);
    await pc.select('#audio-source', 'pc');
    for (const width of [344, 390, 744, 1280]) {
      await pc.setViewport({ width, height: 900 });
      const layout = await pc.evaluate(() => ({ width: document.documentElement.scrollWidth,
        small: [...document.querySelectorAll('button,input,select,a')].filter(item => item.getClientRects().length && item.getBoundingClientRect().height < 43.9).map(item => item.id),
        tiny: [...document.querySelectorAll('label,button,select,p')].filter(item => item.getClientRects().length && parseFloat(getComputedStyle(item).fontSize) < 11).map(item => item.id) }));
      assert(layout.width <= width + 1, `PC input layout overflow at ${width}`); assert.deepEqual(layout.small, []); assert.deepEqual(layout.tiny, []);
      if ([390, 1280].includes(width)) await pc.screenshot({ path: path.join(output, `live-admin-pc-${width}.png`), fullPage: true });
    }
    let pcActions = actions.length;
    await pc.click('#start-button');
    assert.equal(actions.slice(pcActions).some(item => ['createEvent', 'start', 'ticket'].includes(item.action)), false, 'unshared PC input never starts a paid session');
    await pc.evaluate(() => { window.__rejectShare = true; }); await pc.click('#share-pc-audio');
    await pc.waitForFunction(() => window.__capture.shares === 1 && !document.getElementById('share-pc-audio').disabled);
    assert.equal(actions.slice(pcActions).some(item => ['createEvent', 'start', 'ticket'].includes(item.action)), false, 'cancelled sharing never starts a session');
    await pc.evaluate(() => { window.__rejectShare = false; }); await pc.click('#share-pc-audio');
    await pc.waitForFunction(() => window.__capture.prepared);
    await pc.click('#share-pc-audio'); await pc.waitForFunction(() => !window.__capture.prepared);
    await pc.click('#share-pc-audio'); await pc.waitForFunction(() => window.__capture.prepared);
    await pc.click('#start-button'); await pc.waitForFunction(() => window.__capture.running && window.__socketMessages?.some(item => item.type === 'audio'));
    assert.equal(await pc.$eval('#audio-source', item => item.disabled), true);
    assert.equal(await pc.evaluate(() => window.__capture.source), 'pc');
    await pc.click('#pause-button'); await pc.waitForFunction(() => !document.getElementById('resume-button').disabled);
    assert.equal(await pc.evaluate(() => Boolean(window.__capture.running || window.__capture.prepared)), false);
    pcActions = actions.length; await pc.click('#resume-button');
    assert.equal(actions.slice(pcActions).some(item => item.action === 'resume'), false, 'Resume requires fresh sharing before server transition');
    await pc.click('#share-pc-audio'); await pc.waitForFunction(() => window.__capture.prepared);
    await pc.click('#resume-button'); await pc.waitForFunction(() => window.__capture.running && !document.getElementById('pause-button').disabled);
    await pc.evaluate(() => { window.__capture.running = false; window.__capture.options.onDeviceEnded(); });
    await pc.waitForFunction(() => document.getElementById('start-button').textContent === 'Reconnect captions');
    await pc.click('#share-pc-audio'); await pc.waitForFunction(() => window.__capture.prepared);
    await pc.click('#start-button'); await pc.waitForFunction(() => window.__capture.running && !document.getElementById('pause-button').disabled);
    await pc.click('#stop-button'); await pc.waitForFunction(() => document.getElementById('status-text').textContent.includes('stopped'));
    assert.equal(await pc.evaluate(() => Boolean(window.__capture.running || window.__capture.prepared)), false); await pc.close();

    const guest = await makePage(); await guest.goto(`${origin}/live-captions.html?live=1&event=event-1#token=invite-secret`, { waitUntil: 'networkidle0' });
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Snapshot en run-1'));
    assert.equal(await guest.evaluate(() => location.hash), '', 'the code leaves the address bar'); assert.equal(await guest.evaluate(() => window.__captionFake.anonSignIns), undefined, 'no account of any kind');
    const emitOn = (channelLanguage, event, value) => guest.evaluate((topic, name, payload) => window.__captionFake.emit(topic, name, payload), guestTopic(channelLanguage), event, value);
    const emitSigned = (language, event, value) => emitOn(language, event, envelope(guestTopic(language), value));
    await emitSigned('en', 'caption.batch', batch('en', 2, 'Signed en <img onerror=1>'));
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Signed en')); assert.equal(await guest.$eval('#latestText', item => item.children.length), 0);
    const forged = JSON.stringify({ topic: guestTopic('en'), iat: Date.now(), payload: batch('en', 3, 'Forged by another guest') });
    await emitOn('en', 'caption.batch', { data: forged, sig: envelope(guestTopic('en'), { other: true }).sig });
    await emitOn('en', 'caption.batch', envelope(guestTopic('ja'), batch('en', 4, 'Signed for another channel')));
    await emitOn('en', 'caption.batch', envelope(guestTopic('en'), batch('en', 5, 'Replayed ten minutes later'), Date.now() - 600000));
    await guest.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
    assert.match(await guest.$eval('#latestText', item => item.textContent), /^Signed en/, 'forged, misaddressed and stale messages are all ignored');
    await guest.reload({ waitUntil: 'networkidle0' }); await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Snapshot en run-1'));
    await guest.click('[data-language="ja"]'); await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Snapshot ja'));
    assert.equal(await guest.evaluate(() => document.documentElement.lang), 'ja');
    await emitSigned('ja', 'heartbeat', { type: 'heartbeat', eventId: 'event-1', runId: 'run-1', modeGeneration: 1, channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', language: 'ja', messageSeq: 1, status: 'disconnected', publishedAt: new Date().toISOString() });
    await guest.waitForFunction(() => document.getElementById('statusLine').dataset.status === 'waiting');
    currentRunId = 'run-2'; await emitSigned('ja', 'heartbeat', { type: 'heartbeat', eventId: 'event-1', runId: 'run-2', modeGeneration: 2, channelEpoch: 'de7e89c0-34ad-472d-ac41-6ae8f16f24e9', language: 'ja', messageSeq: 1, status: 'live', publishedAt: new Date().toISOString() });
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.includes('run-2')); await guest.close();
    const expired = await makePage(); await expired.goto(`${origin}/live-captions.html?live=1&event=event-1#token=old-code`, { waitUntil: 'networkidle0' });
    await expired.waitForFunction(() => document.getElementById('previewBannerNote')?.textContent.includes('expired or is not valid')); await expired.close();

    const names = actions.map(value => value.action); for (const required of ['config', 'preflight', 'createEvent', 'scripts', 'script', 'select-scripts', 'prepared-cues', 'prepare-script', 'prepared-cue', 'review-prepared-cue', 'select-prepared-script', 'publish-prepared-cue', 'next-prepared', 'clear-prepared', 'start', 'ticket', 'snapshot', 'manual', 'review', 'glossary', 'invite', 'pause', 'resume', 'end', 'stop', 'guestSnapshot']) assert(names.includes(required), `missing action ${required}`);
    const manualCalls = actions.filter(value => value.action === 'manual'); assert.equal(manualCalls.length, 3); assert.equal(manualCalls[0].segmentId, undefined); assert(manualCalls.slice(1).every(value => value.segmentId === 'manual-segment'));
    assert.deepEqual(contractErrors, []); assert.deepEqual(errors, []);
    const report = { result: 'PASS', screenshotDirectory: output, browser: await browser.version(), actions: names,
      checks: ['four-width live auth layout', 'four-width PC input layout', 'four-width prepared manual layout', 'four-width hub password/manual layout', 'pending hub manual start locks logout and parent navigation', 'lost manual-start reply retains unknown-open state across a refused retry and recovers', 'hub manual run survives session lock and restore without capture', 'hub reload restores manual run with End available', 'hub parent activity lock', 'prepare scripts before audio Start', 'inactive new script', 'id and revision edit', 'multiple selection', 'No script', 'generated versus reviewed prepared captions', 'multi-card draft preservation', 'uncertain save preserves current edit', 'manual mode without audio capture', 'late Stop fences prepared selection', 'viewed speech differs from selected speech', 'Show selected caption', 'zero-based prepared cursor', '409 run-state refresh', 'idempotent Next retry', 'four-field prepared concurrency token', 'Next prepared caption', 'Clear guest captions', 'replayed Clear preserves newer caption status', 'restore open manual run', 'publish operation ids', 'user-scoped event restore', 'restore failure keeps audio available', 'PC share/release/cancel', 'PC Start/Resume require sharing', 'PC share-ended recovery', 'config gate', 'magic-link login', 'event and audio start', 'manual and review', 'pause/resume/stop', 'guest QR code', 'scan and read without an account', 'signed captions only', 'expired link', 'reload keeps access', 'locale channel change', 'plain text'] };
    await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { clearTimeout(watchdog); await browser.close(); server.closeAllConnections(); server.close(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
