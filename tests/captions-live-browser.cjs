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
    async start(id) { if (!id) throw new Error('Select a microphone first'); this.starts = (this.starts || 0) + 1; this.running = true; this.options.onState?.('capturing'); this.options.onMeter?.(.4); this.options.onFrame?.(new ArrayBuffer(2400), 1200); }
    async stop() { this.running = false; this.options.onMeter?.(0); this.options.onState?.('stopped'); }
  }
};`;

const { generateKeyPairSync, sign } = require('node:crypto');
const signing = generateKeyPairSync('ec', { namedCurve: 'P-256' }), publicKey = signing.publicKey.export({ format: 'jwk' });
const envelope = value => { const data = JSON.stringify(value); return { data, sig: sign('sha256', Buffer.from(data), { key: signing.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') }; };
const guestTopic = language => `caption-guest:event-1:${language}:0123456789abcdef0123456789abcdef`;

async function main() {
  const modulePath = process.env.PUPPETEER_MODULE || path.resolve(__dirname, '../../Personal - wset-atlas/node_modules/puppeteer');
  const puppeteer = require(modulePath), root = path.resolve(__dirname, '..');
  const output = process.env.CAPTIONS_SCREENSHOT_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'captions-live-'));
  await fs.mkdir(output, { recursive: true });
  const actions = [], errors = [], contractErrors = []; let forceDisabled = false, delayedAction = '', delayedSeen = '', releaseDelayed = null, currentRunId = 'run-1'; const allowed = new Set(['live-captions.html', 'live-captions-admin.html', 'live-captions.css',
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
      const disabled = forceDisabled && input.action === 'config'; if (disabled) forceDisabled = false; let data = {};
      if (input.action === 'config') { if (req.method !== 'GET') contractErrors.push('config_not_get'); data = { enabled: !disabled, guestLinksReady: !disabled, supportedLanguages: ['en', 'ja', 'zh-CN'] }; }
      else if (input.action === 'preflight') data = { enabled: true, guestLinksReady: true, database: true, warnings: [] };
      else if (input.action === 'createEvent') data = { eventId: 'event-1' };
      else if (input.action === 'start') { if (input.mode !== 'live') contractErrors.push('start_mode'); data = { eventId: 'event-1', runId: 'run-1' }; }
      else if (input.action === 'ticket') data = { token: 'single-use-ticket', runId: 'run-1', eventId: 'event-1' };
      else if (input.action === 'snapshot') data = input.runId === currentRunId
        ? batch(input.language, 1, `Snapshot ${input.language} ${currentRunId}`, currentRunId)
        : { ...batch(input.language, 1, `Snapshot ${input.language} ${input.runId}`, input.runId), currentRunId };
      else if (input.action === 'guestSnapshot') {
        if (req.headers.authorization) contractErrors.push('guest_sent_authorization');
        if (input.token !== 'invite-secret' || input.eventId !== 'event-1') { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, requestId: 'fake-request', error: { code: 'GUEST_LINK_INVALID', message: 'This guest link has expired or is not valid' } })); return; }
        const selected = input.runId || currentRunId; data = { ...batch(input.language, 1, `Snapshot ${input.language} ${selected}`, selected), currentRunId, guestTopic: guestTopic(input.language), publicKey };
      }
      else if (input.action === 'manual') data = { segmentId: 'manual-segment', messageSeq: 3, delivery: { attempted: true, delivered: true, queued: false } };
      else if (input.action === 'invite') { if (!input.expiresAt || !Number.isSafeInteger(input.maxUses) || input.maxUses < 65) contractErrors.push('invite_contract'); data = { token: 'guest-invite', inviteId: 'invite-1' }; }
      else if (input.action === 'script') { if (!input.script || typeof input.script !== 'object' || !input.script.title || !input.script.content || !Number.isSafeInteger(input.script.sequence)) contractErrors.push('script_contract'); }
      else if (input.action === 'glossary') { if (!input.entry?.sourceTerm || !Object.hasOwn(input.entry, 'en') || !Object.hasOwn(input.entry, 'ja') || !Object.hasOwn(input.entry, 'zh-CN')) contractErrors.push('glossary_contract'); }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, requestId: 'fake-request', data })); return;
    }
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
        send(value) { const message = JSON.parse(value); this.sent.push(message); (window.__socketMessages ||= []).push(message); if (message.type === 'auth') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', eventId: 'event-1', runId: 'run-1', modeGeneration: 1, channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', frameMs: 50, sampleRate: 24000 }) }), 0); if (message.type === 'drain') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'drained', reason: 'end', withGap: Boolean(window.__drainDeliveryFailure), delivery: window.__drainDeliveryFailure ? { failed: 1, unresolvedFailed: 1 } : { failed: 0, unresolvedFailed: 0 } }) }), 20); }
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

    const guest = await makePage(); await guest.goto(`${origin}/live-captions.html?live=1&event=event-1#token=invite-secret`, { waitUntil: 'networkidle0' });
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Snapshot en run-1'));
    assert.equal(await guest.evaluate(() => location.hash), '', 'the code leaves the address bar'); assert.equal(await guest.evaluate(() => window.__captionFake.anonSignIns), undefined, 'no account of any kind');
    const emitSigned = (language, event, value) => guest.evaluate((topic, name, payload) => window.__captionFake.emit(topic, name, payload), guestTopic(language), event, envelope(value));
    await emitSigned('en', 'caption.batch', batch('en', 2, 'Signed en <img onerror=1>'));
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Signed en')); assert.equal(await guest.$eval('#latestText', item => item.children.length), 0);
    const forged = JSON.stringify(batch('en', 3, 'Forged by another guest')); await guest.evaluate((topic, payload) => window.__captionFake.emit(topic, 'caption.batch', payload), guestTopic('en'), { data: forged, sig: envelope({ other: true }).sig });
    await guest.evaluate(() => new Promise(resolve => setTimeout(resolve, 300))); assert.match(await guest.$eval('#latestText', item => item.textContent), /^Signed en/, 'a forged caption is ignored');
    await guest.reload({ waitUntil: 'networkidle0' }); await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Snapshot en run-1'));
    await guest.click('[data-language="ja"]'); await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('Snapshot ja'));
    assert.equal(await guest.evaluate(() => document.documentElement.lang), 'ja');
    await emitSigned('ja', 'heartbeat', { type: 'heartbeat', eventId: 'event-1', runId: 'run-1', modeGeneration: 1, channelEpoch: '8f87ed59-8961-4964-bcd0-03c0f80818cc', language: 'ja', messageSeq: 1, status: 'disconnected', publishedAt: new Date().toISOString() });
    await guest.waitForFunction(() => document.getElementById('statusLine').dataset.status === 'waiting');
    currentRunId = 'run-2'; await emitSigned('ja', 'heartbeat', { type: 'heartbeat', eventId: 'event-1', runId: 'run-2', modeGeneration: 2, channelEpoch: 'de7e89c0-34ad-472d-ac41-6ae8f16f24e9', language: 'ja', messageSeq: 1, status: 'live', publishedAt: new Date().toISOString() });
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.includes('run-2')); await guest.close();
    const expired = await makePage(); await expired.goto(`${origin}/live-captions.html?live=1&event=event-1#token=old-code`, { waitUntil: 'networkidle0' });
    await expired.waitForFunction(() => document.getElementById('previewBannerNote')?.textContent.includes('expired or is not valid')); await expired.close();

    const names = actions.map(value => value.action); for (const required of ['config', 'preflight', 'createEvent', 'start', 'ticket', 'snapshot', 'manual', 'review', 'glossary', 'script', 'invite', 'pause', 'resume', 'end', 'stop', 'guestSnapshot']) assert(names.includes(required), `missing action ${required}`);
    const manualCalls = actions.filter(value => value.action === 'manual'); assert.equal(manualCalls.length, 3); assert.equal(manualCalls[0].segmentId, undefined); assert(manualCalls.slice(1).every(value => value.segmentId === 'manual-segment'));
    assert.deepEqual(contractErrors, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', screenshotDirectory: output, browser: await browser.version(), actions: names,
      checks: ['four-width live auth layout', 'config gate', 'magic-link login', 'event and audio start', 'manual and review', 'pause/resume/stop', 'guest QR code', 'scan and read without an account', 'signed captions only', 'expired link', 'reload keeps access', 'locale channel change', 'plain text'] }, null, 2));
  } finally { clearTimeout(watchdog); await browser.close(); server.closeAllConnections(); server.close(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
