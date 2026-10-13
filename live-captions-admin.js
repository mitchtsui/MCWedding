(function () {
  'use strict';
  const params = new URLSearchParams(location.search), live = params.get('live') === '1', hub = live && params.get('hub') === '1';
  const previewEnabled = params.get('preview') === '1', preview = window.CaptionsPreview, $ = id => document.getElementById(id);
  const e = { bannerTitle: $('preview-banner-title'), bannerCopy: $('preview-banner-copy'), enableLink: $('enable-preview-link'), guestLink: $('guest-preview-link'),
    statusText: $('status-text'), statusDot: $('status-dot'), mode: $('preflight-preview'), delivery: $('preflight-delivery'), auth: $('preflight-auth'),
    microphone: $('preflight-microphone'), asr: $('preflight-asr'), translation: $('preflight-translation'), start: $('start-button'), pause: $('pause-button'),
    resume: $('resume-button'), next: $('next-button'), end: $('end-button'), stop: $('stop-button'), empty: $('caption-empty'), captions: $('caption-preview'),
    source: $('caption-source'), en: $('caption-en'), ja: $('caption-ja'), zh: $('caption-zh-cn'), form: $('manual-form'), manualEn: $('manual-en'),
    manualJa: $('manual-ja'), manualZh: $('manual-zh-cn'), manualSubmit: $('manual-submit'), manualClear: $('manual-clear'), message: $('manual-message') };
  const controls = [e.start, e.pause, e.resume, e.next, e.end, e.stop], manual = [e.manualEn, e.manualJa, e.manualZh, e.manualSubmit, e.manualClear];
  const setEnabled = value => [...controls, ...manual].forEach(item => { item.disabled = !value; });
  const show = (node, value) => { node.textContent = typeof value === 'string' && value.trim() ? value.trim() : 'Not provided'; };

  function previewMode() {
    const invoke = method => () => { if (previewEnabled && typeof preview?.[method] === 'function') preview[method](); };
    e.start.onclick = invoke('start'); e.pause.onclick = invoke('pause'); e.resume.onclick = invoke('resume'); e.next.onclick = invoke('next'); e.end.onclick = invoke('end'); e.stop.onclick = invoke('stop');
    e.manualClear.onclick = () => { e.manualEn.value = ''; e.manualJa.value = ''; e.manualZh.value = ''; e.message.textContent = 'Fields cleared. The current preview remains on screen.'; };
    e.form.onsubmit = event => { event.preventDefault(); const values = { en: e.manualEn.value.trim(), ja: e.manualJa.value.trim(), 'zh-CN': e.manualZh.value.trim() };
      if (!Object.values(values).some(Boolean)) { e.message.textContent = 'Enter at least one target-language sample.'; return; }
      e.message.textContent = preview?.sendManual?.(values) ? 'Manual sample sent. Blank languages were left blank.' : 'The sample could not be sent.'; };
    if (!previewEnabled) { setEnabled(false); e.guestLink.hidden = true; e.statusText.textContent = 'Not connected'; e.mode.textContent = 'Off'; e.delivery.textContent = 'Not connected'; return; }
    e.enableLink.hidden = true; e.bannerTitle.textContent = 'Operator preview - sample captions only'; e.bannerCopy.textContent = 'No microphone, speech recognition, translation provider, guest broadcast or recording is connected.';
    e.mode.textContent = 'On - synthetic samples'; e.delivery.textContent = 'Same-browser preview only';
    if (typeof preview?.subscribe !== 'function') { setEnabled(false); e.statusText.textContent = 'Preview controls unavailable'; return; }
    setEnabled(true); preview.subscribe(value => { const status = value?.status || 'waiting', segments = Array.isArray(value?.segments) ? value.segments : [];
      const latest = segments.reduce((last, item) => !last || Number(item.order) >= Number(last.order) ? item : last, null);
      const labels = { waiting: 'Preview ready - no audio or provider connected', playing: 'Prepared caption samples are playing', paused: 'Prepared caption samples are paused', ended: 'Prepared caption sample has ended' };
      e.statusText.textContent = labels[status] || labels.waiting; e.statusDot.dataset.state = status; e.start.disabled = status === 'playing'; e.pause.disabled = status !== 'playing'; e.resume.disabled = status !== 'paused'; e.next.disabled = ['waiting', 'ended'].includes(status); e.end.disabled = ['waiting', 'ended'].includes(status); e.stop.disabled = status !== 'playing';
      e.empty.hidden = Boolean(latest); e.captions.hidden = !latest; if (latest) { show(e.source, latest.source); show(e.en, latest.text?.en); show(e.ja, latest.text?.ja); show(e.zh, latest.text?.['zh-CN']); } if (value?.notice) e.message.textContent = value.notice; });
  }

  const load = src => new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => reject(new Error('Required live-caption code did not load')); document.head.append(script); });
  const websocketUrl = () => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/captions-stream';
  async function liveMode() {
    if (hub) {
      document.querySelector('.admin-nav').hidden = true;
      document.querySelector('.operator-grid').hidden = true;
      $('live-auth-email-label').hidden = true; $('live-auth-email').hidden = true; $('live-auth-email').required = false;
      $('live-auth-password-label').hidden = false; $('live-auth-password').hidden = false; $('live-auth-password').disabled = false;
      $('live-auth-submit').textContent = 'Unlock operator controls';
      $('live-auth-copy').textContent = 'Enter the separate six-character caption operator password to run captions. Guests view captions through a link or QR code and cannot use these controls.';
    }
    document.querySelectorAll('.live-only').forEach(node => { node.hidden = false; }); e.next.hidden = true; e.guestLink.hidden = true; e.enableLink.hidden = true; setEnabled(false);
    ['live-device-panel', 'live-invite-panel', 'review-panel', 'content-tools'].forEach(id => { $(id).hidden = true; });
    document.title = 'Live Captions Control - Christy & Mitchell'; $('operator-eyebrow').textContent = 'Operator control room';
    $('operator-subtitle').textContent = 'Private microphone or PC-audio capture, reviewed source captions and three guest language channels.';
    $('controls-title').textContent = 'Live controls'; $('latest-title').textContent = 'Latest captions'; $('manual-title').textContent = 'Manual target captions';
    $('capture-notice').textContent = 'Audio is sent only while the selected microphone or shared PC audio is actively capturing. Video from the browser share picker is never transmitted, rendered or recorded.';
    $('stop-help').textContent = 'Emergency stop cuts local capture immediately, closes the stream and fences the active run.';
    $('operator-footer').textContent = 'Private operator interface - live actions require server authorization';
    e.start.textContent = 'Start live captions'; e.pause.textContent = 'Pause'; e.resume.textContent = 'Resume'; e.end.textContent = 'End'; e.stop.textContent = 'Emergency stop'; e.manualSubmit.textContent = 'Send caption';
    e.manualEn.placeholder = 'Optional English caption'; e.manualJa.placeholder = 'Optional Japanese caption'; e.manualZh.placeholder = 'Optional Simplified Chinese caption';
    e.empty.textContent = 'Captions will appear here after capture starts or you send a manual caption.';
    e.form.previousElementSibling.textContent = 'Enter reviewed text for the languages you want to send. Blank languages remain blank and are never auto-translated.';
    e.bannerTitle.textContent = 'Live captions requested'; e.bannerCopy.textContent = 'Controls stay locked until server configuration and operator authorization pass.'; e.mode.textContent = 'Live requested';
    let client, api, access = '', eventId = '', runId = '', pendingRunId = '', socket, capture, active = false, paused = false, pausing = false, reconnecting = false, intentional = false, connectionGeneration = 0, lifecycleGeneration = 0, shareGeneration = 0, drainWaiter = null, guestReady = false, initialized = false, hubLocked = hub, hubEntranceExpired = false;
    let rotationPreparing = false, rotationDropped = 0, rotationBuffer = [], rotationWatch = 0, lastFrameAt = 0, frameWireBytes = 3400, backlogGraceUntil = 0, undeclared = 0, streamLost = 0, streamAt = 0, resumeAt = 0, phase = 'ready';
    let epoch = '', sequence = 0, sampleOffset = 0; const stores = new Map(), subscriptions = [], reviews = [], drops = [];
    const recover = ' Press Reconnect captions to continue this session, or Emergency stop to close it.';
    const status = (text, state = 'waiting') => { e.statusText.textContent = text; e.statusDot.dataset.state = state; };
    const emitHubState = value => { if (hub && window.parent && window.parent !== window) window.parent.postMessage({ type: 'wedding-hub-caption-state', active: Boolean(value) }, location.origin); };
    const selectedSource = () => $('audio-source').value || 'microphone';
    // 'detached': the run is still open on the server but nothing is capturing. Start reattaches to it; Emergency stop closes it.
    const buttons = state => { phase = state; e.start.disabled = !['ready', 'detached'].includes(state); e.start.textContent = state === 'detached' ? 'Reconnect captions' : 'Start live captions'; e.pause.disabled = state !== 'live'; e.resume.disabled = state !== 'paused'; e.end.disabled = !['live', 'paused'].includes(state); e.stop.disabled = !['live', 'paused', 'connecting', 'detached'].includes(state) && !(state === 'sharing' && runId); manual.forEach(item => { item.disabled = !runId; }); $('create-invite').disabled = !eventId || !guestReady; $('save-glossary').disabled = !eventId; $('save-script').disabled = !eventId;
      const locked = state !== 'ready' || Boolean(runId); $('audio-source').disabled = locked; $('audio-device').disabled = locked || selectedSource() !== 'microphone'; $('refresh-devices').disabled = locked || selectedSource() !== 'microphone';
      const mayShare = selectedSource() === 'pc' && ['ready', 'detached', 'paused'].includes(state); $('share-pc-audio').disabled = !mayShare; $('share-pc-audio').textContent = capture?.hasPreparedDisplay?.() ? 'Release PC audio' : 'Share PC audio'; if (hub) $('hub-logout').disabled = ['connecting', 'sharing'].includes(state) || Boolean(pendingRunId); emitHubState(Boolean(runId || pendingRunId || ['connecting', 'sharing'].includes(state))); };
    const idle = () => buttons(runId ? 'detached' : 'ready');
    const lockHub = (message, entranceExpired = false, notifyParent = true) => { if (!hub || (hubLocked && (!entranceExpired || hubEntranceExpired))) return; hubLocked = true; hubEntranceExpired = entranceExpired; shareGeneration += 1; lifecycleGeneration += 1; connectionGeneration += 1; active = false; paused = false; pausing = false; clearRotation(); closeSubscriptions(); closeSocket(); if (capture) void capture.stop(); setEnabled(false); document.querySelector('.operator-grid').hidden = true; $('hub-logout').hidden = true; $('live-auth-panel').hidden = false; $('live-auth-password').value = ''; $('live-auth-form').hidden = entranceExpired; $('hub-session-retry').hidden = true; const framed = window.parent && window.parent !== window; $('hub-entrance-link').hidden = !entranceExpired || framed;
      $('live-auth-status').textContent = entranceExpired ? message + (framed ? ' Use the wedding-party sign-in dialog; this operator page will retain an open run for recovery.' : ' Use the link below to sign in again. Reloading this standalone page cannot retain an open run.') : message; e.auth.textContent = entranceExpired ? 'Wedding-party session expired' : 'Session expired'; const captionsOpen = Boolean(runId || pendingRunId || ['connecting', 'sharing'].includes(phase)); emitHubState(captionsOpen);
      if (entranceExpired && notifyParent && framed) window.parent.postMessage({ type: 'wedding-hub-session-expired', captionsOpen }, location.origin); };
    const request = async (action, payload) => {
      try {
        if (hub) return await api.request(action, payload);
        access = await window.CaptionsLive.accessToken(client); if (!access) throw Object.assign(new Error('Operator session expired'), { status: 401, code: 'UNAUTHENTICATED' });
        return await api.request(action, payload, access);
      } catch (error) {
        if (hub && error?.status === 401 && error?.code === 'UNAUTHENTICATED') lockHub('Your caption operator session expired. Enter the caption password again. If captions were running, the server session may still be open and can be reconnected after unlock.');
        if (hub && error?.status === 401 && error?.code === 'HUB_UNAUTHENTICATED') lockHub('Your wedding-party session expired. Local capture has stopped. Sign in to the wedding-party hub again; if captions were running, unlock the operator controls and reconnect or close that open run.', true);
        throw error;
      }
    };
    async function restoreHubSession() {
      if (!hub || !hubEntranceExpired) return;
      $('hub-session-retry').hidden = true; $('live-auth-status').textContent = 'Checking the restored wedding-party session...';
      try {
        const operator = await api.request('operatorStatus'); $('hub-entrance-link').hidden = true;
        if (!operator.authenticated) { hubEntranceExpired = false; hubLocked = true; $('live-auth-form').hidden = false; $('live-auth-panel').hidden = false; $('live-auth-status').textContent = 'The wedding-party session is restored. Enter the separate caption operator password to recover these controls.'; e.auth.textContent = 'Caption operator password required'; emitHubState(Boolean(runId || pendingRunId)); return; }
        hubLocked = false; $('live-auth-form').hidden = false; await initializeAuthorized(); hubEntranceExpired = false;
      } catch (error) {
        if (error?.status === 401 && error?.code === 'HUB_UNAUTHENTICATED') lockHub('Your wedding-party session is still locked. Local capture remains stopped.', true, false);
        else if (error?.status === 401 && error?.code === 'UNAUTHENTICATED') return;
        else { $('live-auth-panel').hidden = false; $('live-auth-form').hidden = true; $('hub-entrance-link').hidden = true; $('hub-session-retry').hidden = false; $('live-auth-status').textContent = window.CaptionsLive.cleanError(error.message, 'The restored session could not be checked') + '. Local capture remains stopped; retry the session check.'; }
      }
    }
    if (hub) $('hub-session-retry').onclick = () => void restoreHubSession();
    if (hub) addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      if (event.data?.type === 'wedding-hub-session-lock') lockHub('The wedding-party session is locked. Local capture has stopped.', true, false);
      if (event.data?.type === 'wedding-hub-session-restored') void restoreHubSession();
    });
    const cancelled = () => Object.assign(new Error('Operation cancelled'), { code: 'operation_cancelled' });
    const assertCurrent = operation => { if (operation !== lifecycleGeneration) throw cancelled(); };
    // Only these two codes say the server no longer holds the run open for that action; any other failure leaves that unknown.
    const runClosed = error => error?.code === 'RUN_NOT_OPEN' || error?.code === 'NOT_FOUND';
    const adoptPending = () => { if (!runId && pendingRunId) runId = pendingRunId; pendingRunId = ''; };
    const closeSubscriptions = () => { subscriptions.splice(0).forEach(item => item.close()); stores.clear(); };
    const stopLateRun = async lateRunId => { if (!lateRunId) return; const seen = lifecycleGeneration; let closed = true;
      try { await request('stop', { runId: lateRunId }); } catch (error) { closed = runClosed(error); }
      if (closed && runId === lateRunId) runId = ''; else if (!closed && !runId && !pendingRunId) runId = lateRunId;
      // A newer operation (even one still connecting), or a different tracked run, owns the page; otherwise nothing else will bring the controls up to date.
      if (seen !== lifecycleGeneration || phase === 'connecting' || pendingRunId || (runId && runId !== lateRunId)) return;
      active = paused = false; idle(); status(closed ? 'Captions stopped' : 'Emergency stop did not reach the server; the caption session is still open. Press Emergency stop again.', 'ended'); };
    const deliveryNote = value => value?.delivery?.queued ? ' Saved durably; live delivery is queued.' : value?.delivery?.attempted && value.delivery.delivered === false ? ' Saved durably; live delivery is degraded.' : '';
    const clearRotation = () => { clearTimeout(rotationWatch); rotationPreparing = false; rotationDropped = 0; rotationBuffer = []; };
    const closeSocket = () => { if (drainWaiter) { drainWaiter.reject(cancelled()); drainWaiter = null; } declareLoss(); intentional = true; if (socket) { socket.onclose = null; socket.close(); } socket = null; intentional = false; };
    const drainStream = reason => { if (socket?.readyState !== WebSocket.OPEN) throw new Error('Stream is unavailable'); declareLoss();
      return new Promise((resolve, reject) => { const timer = setTimeout(() => { drainWaiter = null; reject(new Error('Stream drain confirmation timed out')); }, 30000);
        drainWaiter = { reason, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
        socket.send(JSON.stringify({ type: 'drain', reason })); }); };
    const renderReview = info => { const message = reviews[0] || info || null, raw = message?.rawText ?? message?.effectiveText, proposed = message?.proposedText ?? message?.suggestedText, cues = Array.isArray(message?.matchedCueIds) ? message.matchedCueIds.join(', ') : '-';
      $('review-raw').textContent = raw || 'No pending suggestion.'; $('review-proposed').textContent = proposed || '-'; $('review-cues').textContent = reviews.length > 1 ? `${cues} (${reviews.length - 1} more waiting)` : cues; $('review-approve').disabled = !reviews.length; $('review-reject').disabled = !reviews.length; };
    // Suggestions queue behind the one on screen, so Approve always applies to the text the operator has read.
    const queueReview = message => { const raw = message?.rawText ?? message?.effectiveText; if (raw) { show(e.source, raw); e.empty.hidden = true; e.captions.hidden = false; }
      if (!message?.reviewId || message.reviewable === false) { if (!reviews.length) renderReview(message); return; }
      reviews.push(message); if (reviews.length > 20) reviews.splice(1, 1); renderReview(); };
    const clearReviews = () => { reviews.length = 0; renderReview(); };
    const gapNotices = { end_drain_timeout: 'End drain reached its bound; the event will end with an explicit gap.', end_delivery_failed: 'Some final captions were not delivered; the event will end with an explicit gap.', end_caption_failures: 'Some final captions could not be saved or translated; the event will end with an explicit gap.',
      pause_drain_timeout: 'Pause drain reached its bound; capture is stopped and the gap has been recorded.', pause_delivery_failed: 'Some final captions were not delivered before Pause; retry remains queued.', pause_caption_failures: 'Some final captions could not be saved or translated before Pause.',
      rotation_tail_unconfirmed: 'The last words before the scheduled handoff could not be confirmed; the gap has been recorded.', initial_offset: 'Audio was lost while the stream reconnected; the gap has been recorded.', audio_during_rotation: 'Audio sent during the scheduled handoff was not processed; the gap has been recorded.' };
    const notices = { 'asr.error': 'Speech recognition reported an error; the affected words are recorded as a gap.', 'database.degraded': 'Caption storage is degraded; recent captions may not be saved.', 'broadcast.degraded': 'Guest delivery is degraded; saved captions will be retried.',
      'translation.error': 'A translation failed; that caption is marked unavailable.', 'translation.delayed': 'Translation is running behind.', 'script.review_unavailable': 'Script suggestions are temporarily unavailable.', 'script.review_sync_delayed': 'Approved script corrections are delayed.' };
    const notice = message => { const text = message.type === 'error' ? message.message || 'The caption stream reported an error.' : message.type !== 'status' ? '' : message.status === 'stream.gap' ? gapNotices[message.reason] || 'Audio sequence gap detected; durable recovery requested.' : notices[message.status] || ''; if (text) $('audio-alert').textContent = text; };
    const sendFrame = (buffer, samples) => { const data = JSON.stringify({ type: 'audio', captureEpoch: epoch, sequence, sampleOffset, audio: window.CaptionsAudio.bytesToBase64(buffer) }); socket.send(data); frameWireBytes = data.length; lastFrameAt = Date.now(); sequence += 1; sampleOffset += samples; undeclared = 0; };
    // A reconnected stream declares its lost audio through its first frame. If it is closed or drained before sending one, a silent frame carries the declaration.
    const declareLoss = () => { if (undeclared && socket?.readyState === WebSocket.OPEN) sendFrame(new ArrayBuffer(2400), 1200); undeclared = 0; };
    const onFrame = (buffer, samples) => { if (!active || buffer.byteLength !== 2400 || samples !== 1200) return;
      if (rotationPreparing) { if (rotationBuffer.length >= 60) { rotationBuffer.shift(); rotationDropped += 1; $('audio-alert').textContent = 'Scheduled handoff exceeded the three-second buffer; an explicit audio gap will be recorded.'; } rotationBuffer.push({ buffer, samples }); return; }
      if (socket?.readyState !== WebSocket.OPEN) return;
      // The backlog is measured in bytes as queued (base64 JSON), and a replayed handoff buffer is given three seconds to flush.
      if (Date.now() >= backlogGraceUntil && socket.bufferedAmount > frameWireBytes * 60) { $('audio-alert').textContent = 'Audio upload fell more than three seconds behind. Reconnecting with an explicit gap.'; void reconnect('Audio upload backlog exceeded three seconds.'); return; }
      sendFrame(buffer, samples); };
    const failCapture = async (operation, message) => { connectionGeneration += 1; active = false; clearRotation(); closeSocket(); await capture.stop(); if (operation !== lifecycleGeneration) return; idle(); status('Audio gap: ' + message + '.' + recover, 'ended'); $('audio-alert').textContent = 'Capture stopped. The caption session is still open.'; };
    async function reconnect(reason) { if (reconnecting || !active || paused || pausing) return; const operation = lifecycleGeneration, targetRunId = runId, now = Date.now(); reconnecting = true; clearRotation(); if (socket?.bufferedAmount) lastFrameAt -= Math.ceil(socket.bufferedAmount / frameWireBytes) * 50; closeSocket(); await capture.stop();
      // getDisplayMedia requires a fresh user gesture. Never open its picker from an automatic reconnect.
      if (selectedSource() === 'pc') { reconnecting = false; if (operation !== lifecycleGeneration) return; active = false; idle(); status('PC audio sharing stopped after the caption stream disconnected. Share PC audio, then press Reconnect captions.' + (runId ? recover : ''), 'ended'); $('audio-alert').textContent = 'PC audio sharing is off. The caption session is still open.'; return; }
      // A fourth automatic reconnect within a minute means the stream is not staying up: stop retrying and leave the choice to the operator.
      try { while (drops.length && now - drops[0] > 60000) drops.shift(); drops.push(now); if (drops.length > 3) throw new Error('The stream keeps disconnecting');
        if (operation === lifecycleGeneration) status(reason + ' Reconnecting for up to 3 seconds.');
        await Promise.race([connect(operation, targetRunId, false, true), new Promise((_, reject) => setTimeout(() => reject(new Error('Reconnect timed out')), 3000))]); } catch (error) { if (operation === lifecycleGeneration) await failCapture(operation, error.message); } finally { reconnecting = false; } }
    async function rotateStream() { if (reconnecting || (!active && !pausing) || paused) return; const operation = lifecycleGeneration, targetRunId = runId; reconnecting = true; clearTimeout(rotationWatch); rotationPreparing = true; closeSocket(); if (!pausing) status('Scheduled stream handoff in progress; captured audio is buffered for up to three seconds.');
      // A handoff that fails falls back to one ordinary reconnect, which declares the lost audio as a gap, before capture is given up.
      try { await Promise.race([connect(operation, targetRunId, true), new Promise((_, reject) => setTimeout(() => reject(new Error('Scheduled handoff timed out')), 15000))]); } catch (error) { if (operation === lifecycleGeneration) { connectionGeneration += 1; reconnecting = false; await reconnect('Scheduled handoff failed (' + error.message + ').'); } } finally { reconnecting = false; } }
    async function connect(operation, targetRunId, reuseCapture = false, declareGap = false) {
      assertCurrent(operation); const connection = ++connectionGeneration, kind = selectedSource(), device = $('audio-device').value; if (kind === 'microphone' && !device) throw new Error('Select a microphone first'); if (kind === 'pc' && !reuseCapture && !capture.hasPreparedDisplay()) throw new Error('Share PC audio before connecting'); const ticket = await request('ticket', { runId: targetRunId, origin: location.origin });
      assertCurrent(operation); if (connection !== connectionGeneration) throw cancelled();
      intentional = false;
      await new Promise((resolve, reject) => { const ws = new WebSocket(websocketUrl()); socket = ws; let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; ws.close(); reject(new Error('Stream authorization timed out')); } }, 5000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket: ticket.token }));
        ws.onmessage = event => { let message; try { message = JSON.parse(event.data); } catch { return; }
          if (ws !== socket) return;
          if (message.type === 'status' && message.status === 'drained' && drainWaiter?.reason === message.reason) { drainWaiter.resolve(message); drainWaiter = null; return; }
          if (operation !== lifecycleGeneration) { if (!settled) { settled = true; clearTimeout(timer); reject(cancelled()); } return; }
          if (message.type === 'ready' && !settled) { settled = true; clearTimeout(timer); resolve(); }
          else if (message.type === 'error' && !settled) { settled = true; clearTimeout(timer); reject(new Error(message.message || 'The caption stream was refused')); }
          else if (message.type === 'rotate') void rotateStream();
          // If the announced handoff never arrives, start it from this side rather than buffering indefinitely.
          else if (message.type === 'status' && message.status === 'rotation.preparing') { if (!rotationPreparing) clearRotation(); rotationPreparing = true; clearTimeout(rotationWatch); rotationWatch = setTimeout(() => void rotateStream(), 20000); }
          else if (message.type === 'review') queueReview(message); else if (message.type === 'source' && typeof message.text === 'string') { show(e.source, message.text); e.empty.hidden = true; e.captions.hidden = false; }
          else notice(message); };
        ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Stream connection failed')); } };
        ws.onclose = () => { clearTimeout(timer); if (drainWaiter) { drainWaiter.reject(new Error('Stream closed before the drain completed')); drainWaiter = null; } if (!settled) { settled = true; reject(new Error('The caption stream closed before it was ready')); } else if (operation === lifecycleGeneration && !intentional && active && !paused && !pausing) void reconnect('Stream disconnected.'); }; });
      assertCurrent(operation); if (connection !== connectionGeneration) throw cancelled();
      epoch = crypto.randomUUID?.() || String(Date.now()) + Math.random(); $('audio-alert').textContent = '';
      if (reuseCapture) { streamLost = sequence = rotationDropped; sampleOffset = rotationDropped * 1200; const buffered = rotationBuffer; clearRotation(); for (const frame of buffered) sendFrame(frame.buffer, frame.samples); backlogGraceUntil = Date.now() + 3000; }
      // A stream that starts above sequence 0 makes the server record the frames lost before it as a gap.
      else { clearRotation(); const lost = declareGap && lastFrameAt ? Math.max(1, Math.round((Date.now() - lastFrameAt) / 50)) : 0; streamLost = undeclared = sequence = lost; sampleOffset = lost * 1200; await capture.start(kind, device); }
      if (operation !== lifecycleGeneration || connection !== connectionGeneration) { await capture.stop(); throw cancelled(); }
      // A stream that closed while local capture was starting found a reconnect already in flight and was ignored; do not report it as live.
      if (socket?.readyState !== WebSocket.OPEN) { await capture.stop(); throw new Error('The caption stream closed while audio capture was starting'); }
      resumeAt = 0; streamAt = Date.now(); if (!pausing) { e.microphone.textContent = selectedSource() === 'pc' ? 'Capturing shared PC audio' : 'Capturing selected device'; status(selectedSource() === 'pc' ? 'Live PC audio connected' : 'Live microphone connected', 'playing'); buttons('live'); }
    }
    // Until the page has microphone permission, browsers list inputs without ids, which cannot be selected.
    let needsPermission = false;
    async function devices() { const select = $('audio-device'), all = await capture.devices(), values = all.filter(item => item.id), selected = select.value; needsPermission = all.length > 0 && !values.length;
      select.replaceChildren(new Option(needsPermission ? 'Allow microphone access to list devices' : 'Select a microphone', '')); values.forEach((item, index) => select.append(new Option(item.label || 'Microphone ' + (index + 1), item.id))); if (values.some(item => item.id === selected)) select.value = selected; select.disabled = false; $('refresh-devices').disabled = false;
      $('refresh-devices').textContent = needsPermission ? 'Allow microphone' : 'Refresh devices'; e.microphone.textContent = needsPermission ? 'Microphone access needed' : values.length ? 'Device selection ready' : 'No audio input found'; }
    async function refreshDevices() { $('audio-alert').textContent = '';
      try { const asked = needsPermission; if (asked) await capture.permit(); await devices();
        if (needsPermission) $('audio-alert').textContent = 'Microphone access is still blocked. Allow it in the browser\'s site settings, then press Allow microphone again.';
        else if (asked && phase === 'ready') status('Ready - select a microphone, then start'); }
      catch (error) { $('audio-alert').textContent = error?.name === 'NotAllowedError' ? 'Microphone access was refused. Allow it in the browser\'s site settings, then press Allow microphone again.' : error.message; } }
    function sharePcAudio() {
      if (capture.hasPreparedDisplay()) { shareGeneration += 1; capture.discardPrepared(); buttons(phase); e.microphone.textContent = 'PC audio share released'; status(runId ? 'PC audio is off. Share it again before Resume or Reconnect.' : 'Ready - choose an audio source', 'waiting'); return; }
      // Keep this as the first asynchronous browser call in the click handler. The picker requires this user gesture.
      const pending = capture.prepareDisplay(), operation = ++shareGeneration, previousPhase = phase;
      buttons('sharing'); e.microphone.textContent = 'Waiting for PC audio share'; $('audio-alert').textContent = '';
      pending.then(() => { if (operation !== shareGeneration) return; buttons(previousPhase); e.microphone.textContent = 'PC audio share ready'; status(runId ? 'PC audio ready - press ' + (previousPhase === 'paused' ? 'Resume' : 'Reconnect captions') : 'PC audio ready - press Start live captions'); })
        .catch(error => { if (operation !== shareGeneration) return; buttons(previousPhase); e.microphone.textContent = 'PC audio is not shared'; const denied = error?.name === 'NotAllowedError' || error?.name === 'AbortError'; $('audio-alert').textContent = denied ? 'PC audio sharing was cancelled or refused. No caption session was started.' : error.message; status(runId ? 'PC audio is off. Share it before continuing this session.' : 'Ready - PC audio has not been shared', 'waiting'); });
    }
    function sourceChanged() { shareGeneration += 1; capture.discardPrepared(); $('audio-alert').textContent = ''; buttons(phase); e.microphone.textContent = selectedSource() === 'pc' ? 'PC audio has not been shared' : needsPermission ? 'Microphone access needed' : 'Device selection ready'; status(selectedSource() === 'pc' ? 'Ready - share PC audio, then start' : 'Ready - select a microphone, then start'); }
    const renderLanguage = language => { const values = stores.get(language)?.segments(language) || [], latest = values[values.length - 1], target = language === 'en' ? e.en : language === 'ja' ? e.ja : e.zh; if (latest) { show(target, latest.text); e.empty.hidden = true; e.captions.hidden = false; } };
    async function subscribe(language, scope, operation) {
      if (hub) {
        let closed = false, polling = false, timer = 0;
        const store = new window.CaptionsLive.CaptionStore(() => { if (!polling) void poll(); }); stores.set(language, store);
        const poll = async () => { if (closed || polling || operation !== lifecycleGeneration) return; polling = true;
          try { const value = await request('snapshot', { ...scope, language }); assertCurrent(operation); store.merge(value); renderLanguage(language); }
          catch (error) { if (operation === lifecycleGeneration && error.code !== 'operation_cancelled' && error.code !== 'UNAUTHENTICATED') status('Caption refresh failed; retrying shortly.'); }
          finally { polling = false; if (!closed && operation === lifecycleGeneration && !hubLocked) timer = setTimeout(poll, 2000); } };
        const subscription = { close() { closed = true; clearTimeout(timer); } }; subscriptions.push(subscription); await poll(); assertCurrent(operation); return;
      }
      let syncing = true, buffered = []; const store = new window.CaptionsLive.CaptionStore(() => void resync()); stores.set(language, store);
      async function resync() { if (syncing || operation !== lifecycleGeneration) return; syncing = true; try { const value = await request('snapshot', { ...scope, language }); assertCurrent(operation); store.merge(value); buffered.forEach(batch => store.merge(batch)); buffered = []; renderLanguage(language); } catch (error) { if (operation === lifecycleGeneration && error.code !== 'operation_cancelled') status('Caption resync failed; retrying on the next update.'); } finally { syncing = false; } }
      const initial = await request('snapshot', { ...scope, language }); assertCurrent(operation); if (!initial.topic) throw new Error('Private caption channel unavailable');
      await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Private caption channel timed out')), 5000);
        const subscription = window.CaptionsLive.subscribe(client, initial.topic, batch => { if (operation !== lifecycleGeneration) return; if (syncing) buffered.push(batch); else { const changed = store.merge(batch); if (changed && !syncing) renderLanguage(language); } },
          state => { if (state === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } else if (state === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('Private caption channel failed')); } }); subscriptions.push(subscription); });
      assertCurrent(operation); const current = await request('snapshot', { ...scope, language }); assertCurrent(operation); store.merge(current); buffered.forEach(batch => store.merge(batch)); buffered = []; syncing = false; renderLanguage(language);
    }
    async function start() { if (selectedSource() === 'microphone' && !$('audio-device').value) { e.statusText.textContent = 'Select a microphone first'; return; } if (selectedSource() === 'pc' && !capture.hasPreparedDisplay()) { e.statusText.textContent = 'Share PC audio before starting captions'; return; }
      adoptPending(); const operation = ++lifecycleGeneration, reattach = runId; connectionGeneration += 1; clearRotation(); closeSubscriptions(); drops.length = 0; buttons('connecting'); status(reattach ? 'Reconnecting to the open caption session...' : 'Starting live caption session...'); let localRunId = reattach;
      try { if (!reattach) { if (!eventId) { eventId = (await request('createEvent', { title: 'Wedding live captions', settings: { reviewRequired: true, languages: window.CaptionsLive.languages } })).eventId; assertCurrent(operation); }
          const started = await request('start', { eventId, mode: 'live' }); localRunId = started.runId; lastFrameAt = Date.now();
          // The event already had an open run: an earlier Start whose reply was lost, or another operator. It is never taken over or stopped unasked.
          if (started.alreadyOpen) { adoptPending(); if (!runId) runId = localRunId; if (operation === lifecycleGeneration || !e.start.disabled) { idle(); status('This event already has an open caption session. Press Reconnect captions to take it over, or Emergency stop to close it.', 'ended'); } return; }
          if (operation !== lifecycleGeneration) { if (runId !== localRunId) await stopLateRun(localRunId); return; }
          pendingRunId = localRunId; clearReviews(); }
        const scope = { eventId, runId: localRunId };
        await Promise.all(window.CaptionsLive.languages.map(language => subscribe(language, scope, operation))); assertCurrent(operation);
        runId = localRunId; pendingRunId = ''; active = true; paused = false;
        try { await connect(operation, localRunId, false, Boolean(reattach)); } catch (error) { if (!reattach || error.code !== 'RUN_NOT_OPEN') throw error;
          // An open run that refuses audio is paused (a Pause whose reply was lost) or has closed; resuming tells which.
          lastFrameAt = resumeAt ||= Date.now(); await request('resume', { runId: localRunId }); assertCurrent(operation); await connect(operation, localRunId); }
      } catch (error) { if (operation !== lifecycleGeneration || error.code === 'operation_cancelled') return; connectionGeneration += 1; adoptPending(); active = false; closeSocket(); await capture.stop(); if (operation !== lifecycleGeneration) return;
        if (reattach && runClosed(error)) { runId = ''; closeSubscriptions(); clearReviews(); buttons('ready'); status('That caption session has already ended. Press Start live captions to begin a new one.', 'ended'); return; }
        idle(); status(error.message + (runId ? '.' + recover : ''), 'ended'); } }
    async function pauseGracefully() {
      adoptPending(); const targetRunId = runId, waiting = lifecycleGeneration; active = false; paused = false; pausing = true; buttons('connecting'); status('Audio capture stopped; finishing already captured words before pausing...');
      const ordinaryReconnect = reconnecting && !rotationPreparing;
      if (ordinaryReconnect) { lifecycleGeneration += 1; connectionGeneration += 1; pausing = false; clearRotation(); closeSocket(); closeSubscriptions(); await capture.stop(); idle(); status('Pause could not finish while the stream was reconnecting. Capture is off.' + recover, 'ended'); return; }
      await capture.stop(); if (waiting !== lifecycleGeneration) return;
      if (rotationPreparing || reconnecting) { const deadline = Date.now() + 45000;
        while ((rotationPreparing || reconnecting) && waiting === lifecycleGeneration && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (waiting !== lifecycleGeneration) return;
        if (rotationPreparing || reconnecting) { lifecycleGeneration += 1; connectionGeneration += 1; pausing = false; clearRotation(); closeSocket(); closeSubscriptions(); idle(); status('Pause could not finish the stream handoff. Capture is off.' + recover, 'ended'); return; } }
      const operation = ++lifecycleGeneration; connectionGeneration += 1; clearRotation();
      try {
        const drained = await drainStream('pause'); assertCurrent(operation);
        const result = await request('pause', { runId: targetRunId }); assertCurrent(operation); connectionGeneration += 1; pausing = false; closeSocket(); closeSubscriptions(); active = paused = true; resumeAt = 0; buttons('paused');
        const pendingDelivery = (drained?.delivery?.unresolvedFailed ?? 0) > 0 || (drained?.delivery?.failed ?? 0) > 0;
        const lostCaptions = (drained?.failures?.captions ?? 0) > 0 || (drained?.failures?.sources ?? 0) > 0;
        const message = pendingDelivery ? 'Captions paused; final caption delivery has pending failures' : lostCaptions ? 'Captions paused; some final captions could not be saved or translated' : drained?.withGap ? 'Captions paused with an explicit gap' : 'Captions paused after the last captured words completed';
        status(message + deliveryNote(result), 'paused');
      } catch (error) { if (operation !== lifecycleGeneration || error.code === 'operation_cancelled') return; connectionGeneration += 1; pausing = false; closeSocket(); closeSubscriptions(); active = paused = false; idle();
        status('Pause was not confirmed by the server (' + error.message + '). Capture is off.' + recover, 'ended'); }
    }
    async function control(action) { shareGeneration += 1; const operation = ++lifecycleGeneration; adoptPending(); const targetRunId = runId; connectionGeneration += 1; active = false; paused = false; pausing = false; clearRotation(); closeSubscriptions(); buttons('connecting'); status(action === 'pause' ? 'Pausing captions...' : 'Stopping captions...'); closeSocket(); await capture.stop();
      if (!targetRunId) { if (operation === lifecycleGeneration) { buttons('ready'); status(action === 'pause' ? 'Captions are not active' : 'Captions stopped', action === 'pause' ? 'paused' : 'ended'); } return; }
      try { const result = await request(action, { runId: targetRunId }); if (action === 'stop' && runId === targetRunId) runId = ''; if (operation !== lifecycleGeneration) return;
        if (action === 'stop') { clearReviews(); buttons('ready'); $('audio-alert').textContent = ''; status('Captions stopped' + deliveryNote(result), 'ended'); } else { active = paused = true; resumeAt = 0; buttons('paused'); status('Captions paused' + deliveryNote(result), 'paused'); }
      } catch (error) { const closed = action === 'stop' && (runClosed(error) || runId !== targetRunId); if (closed && runId === targetRunId) runId = ''; if (operation !== lifecycleGeneration) return; active = paused = false; if (closed) { clearReviews(); $('audio-alert').textContent = ''; } idle();
        status(closed ? 'Captions stopped; the session was already closed' : (action === 'stop' ? 'Emergency stop' : 'Pause') + ' was not confirmed by the server (' + error.message + '). Capture is off.' + recover, 'ended'); } }
    async function endGracefully() {
      // A handoff in flight still holds the last buffered words, so End waits for it instead of draining the wrong socket.
      let waited = false;
      if (rotationPreparing || reconnecting) { const waiting = lifecycleGeneration, deadline = Date.now() + 45000; waited = true; buttons('connecting'); status('Completing the stream handoff before ending...');
        while ((rotationPreparing || reconnecting) && waiting === lifecycleGeneration && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (waiting !== lifecycleGeneration || !active) return;
        if (rotationPreparing || reconnecting) { status('The stream handoff did not complete; use Emergency stop to close with an explicit gap', 'ended'); return; } }
      const operation = ++lifecycleGeneration, targetRunId = runId, wasPaused = paused; active = false; paused = false; clearRotation(); buttons('connecting'); status(wasPaused ? 'Ending captions...' : 'Finishing the last spoken words before ending...'); await capture.stop();
      try {
        // Words lost to a failed or overflowing handoff, or to a reconnect just before End, are a final-audio gap even when the drain itself is clean.
        assertCurrent(operation); let drained = null; const finalGap = !wasPaused && (undeclared > 0 || (streamLost > 0 && (waited || Date.now() - streamAt < 10000)));
        // A paused run has no stream and nothing left to drain: pausing already closed it.
        if (!wasPaused) { drained = await drainStream('end'); assertCurrent(operation); }
        const result = await request('end', { runId: targetRunId }); if (runId === targetRunId) runId = ''; assertCurrent(operation); connectionGeneration += 1; closeSocket(); closeSubscriptions(); clearReviews(); buttons('ready');
        const pendingDelivery = (drained?.delivery?.unresolvedFailed ?? 0) > 0 || (drained?.delivery?.failed ?? 0) > 0;
        const lostCaptions = (drained?.failures?.captions ?? 0) > 0 || (drained?.failures?.sources ?? 0) > 0 || (result?.pendingRecognizedFinalSources ?? 0) > 0;
        const pendingUnknown = result?.pendingRecognizedFinalsChecked !== true || result?.pendingRecognizedFinalsTruncated === true;
        const message = pendingUnknown ? 'Captions ended; completion of recognized-speech translations could not be fully checked' : pendingDelivery ? 'Captions ended; final caption delivery has pending failures' : lostCaptions ? 'Captions ended; some recognized final speech could not be saved or fully translated' : !drained ? 'Captions ended; no unfinished translations of recognized speech were found' : drained.withGap || finalGap ? 'Captions ended with an explicit final-audio gap' : 'Captions ended after the final words completed';
        status(message + deliveryNote(result), 'ended');
      } catch (error) { if (operation !== lifecycleGeneration || error.code === 'operation_cancelled') return;
        if (runClosed(error)) { if (runId === targetRunId) runId = ''; connectionGeneration += 1; closeSocket(); closeSubscriptions(); clearReviews(); buttons('ready'); status('Captions ended; the session was already closed', 'ended'); }
        else if (wasPaused) { active = paused = true; buttons('paused'); status('End failed: ' + error.message, 'paused'); }
        else { connectionGeneration += 1; closeSocket(); idle(); status('End failed: ' + error.message + '.' + recover, 'ended'); } }
    }
    async function resume() { if (selectedSource() === 'pc' && !capture.hasPreparedDisplay()) { status('Share PC audio before resuming captions', 'paused'); return; } const operation = ++lifecycleGeneration, targetRunId = runId; connectionGeneration += 1; closeSubscriptions(); buttons('connecting'); status('Resuming captions...'); let resumed = false;
      // Counted from the first attempt since the pause: if its reply was lost, the run has been live since then.
      try { lastFrameAt = resumeAt ||= Date.now(); await request('resume', { runId: targetRunId }); resumed = true; if (operation !== lifecycleGeneration) { await stopLateRun(targetRunId); return; }
        const scope = { eventId, runId: targetRunId }; await Promise.all(window.CaptionsLive.languages.map(language => subscribe(language, scope, operation))); assertCurrent(operation);
        active = true; paused = false; await connect(operation, targetRunId);
      } catch (error) { if (operation !== lifecycleGeneration || error.code === 'operation_cancelled') return; connectionGeneration += 1; closeSocket(); await capture.stop(); if (operation !== lifecycleGeneration) return;
        // Unless the server said the run is not paused, a failed resume request leaves it paused.
        if (!resumed && !runClosed(error)) { active = paused = true; buttons('paused'); status('Resume failed: ' + error.message, 'paused'); return; }
        active = paused = false; idle(); status(error.message + '.' + recover, 'ended'); } }
    async function initializeAuthorized() {
      const preflight = await request('preflight'); $('live-auth-panel').hidden = true; if (!preflight.enabled) throw new Error('Live preflight is disabled'); ['live-device-panel', 'live-invite-panel', 'review-panel', 'content-tools'].forEach(id => { $(id).hidden = false; }); guestReady = preflight.guestLinksReady === true; e.auth.textContent = 'Authorized by server'; e.asr.textContent = 'Available after start'; e.translation.textContent = 'Available after start'; e.delivery.textContent = guestReady ? 'Guest QR links on (no guest sign-in)' : 'Guest links switched off'; e.bannerTitle.textContent = 'Live operator controls'; e.bannerCopy.textContent = guestReady ? 'Choose a microphone or explicitly share PC audio before Start. Capture begins only after the selected source is ready.' : 'Operator capture is available; guest links are switched off on this server.';
      if (hub) { hubLocked = false; document.querySelector('.operator-grid').hidden = false; $('hub-logout').hidden = false; }
      if (initialized) { idle(); status(runId ? 'Operator session restored. Reconnect or close the open caption session.' : 'Operator session restored. Ready to start captions.'); return; }
      initialized = true;
      capture = new window.CaptionsAudio.Capture({ onFrame, onMeter: value => { $('audio-meter').value = value; }, onPrepared: () => { if (capture) buttons(phase); }, onDeviceEnded: info => {
        if (info?.active === false && phase !== 'connecting') { shareGeneration += 1; buttons(phase); e.microphone.textContent = 'PC audio sharing stopped'; $('audio-alert').textContent = 'PC audio sharing stopped. Share it again before starting or continuing captions.'; return; }
        shareGeneration += 1; lifecycleGeneration += 1; connectionGeneration += 1; adoptPending(); active = false; paused = false; pausing = false; clearRotation(); closeSubscriptions(); closeSocket(); idle(); const pc = info?.source === 'pc'; e.microphone.textContent = pc ? 'PC audio sharing stopped' : 'Selected device disconnected'; status(pc ? 'PC audio sharing stopped; capture stopped.' + (runId ? recover : '') : 'The selected microphone disconnected; capture stopped.' + (runId ? recover : ''), 'ended'); $('audio-alert').textContent = pc ? 'PC audio sharing stopped. Capture stopped.' : 'The selected microphone disconnected. Capture stopped.'; }, onState: state => { if (state === 'stopped') $('audio-meter').value = 0; } });
      await devices(); buttons('ready'); status(needsPermission ? 'Ready - press Allow microphone, then select a microphone' : 'Ready - select a microphone, then start'); e.start.onclick = start; e.pause.onclick = pauseGracefully; e.resume.onclick = resume; e.end.onclick = endGracefully; e.stop.onclick = () => control('stop'); $('refresh-devices').onclick = refreshDevices; $('share-pc-audio').onclick = sharePcAudio; $('audio-source').onchange = sourceChanged;
      e.manualClear.onclick = () => { e.manualEn.value = ''; e.manualJa.value = ''; e.manualZh.value = ''; }; e.form.onsubmit = async event => { event.preventDefault(); const values = { en: e.manualEn.value.trim(), ja: e.manualJa.value.trim(), 'zh-CN': e.manualZh.value.trim() }, entries = Object.entries(values).filter(([, text]) => text); if (!entries.length) { e.message.textContent = 'Enter at least one target-language caption.'; return; } try { const [first, ...remaining] = entries, firstResult = await request('manual', { runId, language: first[0], text: first[1] }), segmentId = firstResult.segmentId; const outcomes = [firstResult]; for (const [language, text] of remaining) outcomes.push(await request('manual', { runId, language, text, segmentId })); e.message.textContent = 'Manual caption saved for the selected languages.' + (outcomes.map(deliveryNote).find(Boolean) || ''); } catch (error) { e.message.textContent = error.message; } };
      const decide = async decision => { const review = reviews[0]; if (!review) return; $('review-approve').disabled = true; $('review-reject').disabled = true; try { await request('review', { reviewId: review.reviewId, decision }); if (reviews[0] === review) reviews.shift(); $('content-tools-status').textContent = decision === 'approve' ? 'Suggestion approved.' : 'Raw text kept.'; } catch (error) { $('content-tools-status').textContent = error.message; } finally { renderReview(); } };
      $('review-approve').onclick = () => decide('approve'); $('review-reject').onclick = () => decide('reject'); $('save-glossary').onclick = async () => { const entry = { sourceTerm: $('glossary-source').value.trim(), en: $('glossary-en').value.trim() || null, ja: $('glossary-ja').value.trim() || null, 'zh-CN': $('glossary-zh-cn').value.trim() || null, aliases: [], priority: 0 }; if (!entry.sourceTerm) { $('content-tools-status').textContent = 'Enter a glossary source term.'; return; } try { await request('glossary', { eventId, entry }); $('content-tools-status').textContent = 'Glossary saved.'; } catch (error) { $('content-tools-status').textContent = error.message; } }; $('save-script').onclick = async () => { const script = { title: $('script-title').value.trim(), content: $('script-text').value, sequence: Number($('script-sequence').value), active: true }; if (!script.title || !script.content.trim() || !Number.isSafeInteger(script.sequence) || script.sequence < 0) { $('content-tools-status').textContent = 'Enter a script title, content and valid sequence.'; return; } try { await request('script', { eventId, script }); $('content-tools-status').textContent = 'Advance script saved.'; } catch (error) { $('content-tools-status').textContent = error.message; } };
      const expiry = new Date(Date.now() + 86400000); expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset()); $('invite-expiry').value = expiry.toISOString().slice(0, 16);
      // Account-free guest links: the private code in the QR link is the guest's only key, so a use limit cannot apply.
      const maxUses = 500, maxUsesField = $('invite-max-uses'); maxUsesField.hidden = true; if (maxUsesField.previousElementSibling) maxUsesField.previousElementSibling.hidden = true;
      const showInvite = (href, expiresAt) => { const output = $('invite-output'), note = document.createElement('p'), code = document.createElement('code'); output.replaceChildren(note);
        note.textContent = `Guests scan this to read live captions, with no sign-in. It works until ${expiresAt.toLocaleString()}.`; code.className = 'invite-link'; code.textContent = href;
        if (typeof window.qrcode === 'function') { const qr = window.qrcode(0, 'M'); qr.addData(href); qr.make(); const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true }));
          const image = document.createElement('img'), save = document.createElement('a'); image.src = source; image.alt = 'QR code that opens the live captions'; image.className = 'invite-qr'; image.width = 240; image.height = 240;
          save.href = source; save.download = 'wedding-live-captions-qr.svg'; save.className = 'button button-quiet'; save.textContent = 'Save QR code'; output.append(image, save); }
        output.append(code); };
      $('create-invite').onclick = async () => { try { const expiresAt = new Date($('invite-expiry').value); if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error('Enter a future expiry time for the guest link');
        if (typeof window.qrcode !== 'function') await load('vendor/qr.js').catch(() => undefined);
        const invite = await request('invite', { eventId, expiresAt: expiresAt.toISOString(), maxUses }), link = new URL('live-captions.html', location.href); link.search = new URLSearchParams({ live: '1', event: eventId }); link.hash = new URLSearchParams({ token: invite.token });
        if (hub && window.parent && window.parent !== window) window.parent.postMessage({ type: 'wedding-hub-caption-invite', eventId, token: invite.token }, location.origin);
        showInvite(link.href, expiresAt); } catch (error) { $('invite-output').textContent = error.message; } }; if (!hub) window.CaptionsLive.keepRealtimeAuth(client);
      // A page restored from the back/forward cache must not still claim to be capturing.
      addEventListener('pagehide', () => { shareGeneration += 1; lifecycleGeneration += 1; connectionGeneration += 1; adoptPending(); pausing = false; clearRotation(); void capture.stop(); closeSocket(); closeSubscriptions(); if (paused) { buttons('paused'); status('Captions paused', 'paused'); return; } active = false; idle(); if (runId) status('Capture stopped because this page was left.' + recover, 'ended'); });
    }
    try {
      if (!hub) { await load('/api/config.js'); await load('vendor/supabase.js'); }
      await load('live-captions-client.js'); await load('live-captions-audio.js'); api = window.CaptionsLive.create(); const config = await api.request('config'); if (!config.enabled) throw new Error('Live captions are disabled by server configuration'); guestReady = config.guestLinksReady === true;
      if (hub) {
        $('live-auth-form').onsubmit = async event => { event.preventDefault(); const submit = $('live-auth-submit'); submit.disabled = true; $('live-auth-status').textContent = 'Checking password...'; try {
          await api.request('operatorLogin', { password: $('live-auth-password').value }); hubLocked = false; hubEntranceExpired = false; $('live-auth-password').value = ''; await initializeAuthorized();
        } catch (error) { hubLocked = true; $('live-auth-status').textContent = error.code === 'INVALID_CREDENTIALS' ? 'That password was not accepted. Try again.' : window.CaptionsLive.cleanError(error.message, 'Operator sign-in failed'); }
        finally { submit.disabled = false; } };
        $('hub-logout').onclick = async () => { const button = $('hub-logout'); if (['connecting', 'sharing'].includes(phase) || pendingRunId) { button.disabled = true; $('audio-alert').textContent = 'Wait for the current caption action to finish before logging out.'; return; } button.disabled = true; try {
          if (runId || pendingRunId) { await control('stop'); if (runId || pendingRunId) throw new Error('The caption session could not be closed. Use Emergency stop before logging out.'); }
          await api.request('operatorLogout'); lockHub('Logged out. Enter the password to operate captions again.'); e.auth.textContent = 'Logged out'; emitHubState(false);
        } catch (error) { $('live-auth-status').textContent = window.CaptionsLive.cleanError(error.message, 'Logout failed'); }
        finally { button.disabled = ['connecting', 'sharing'].includes(phase) || Boolean(pendingRunId); } };
        const operator = await api.request('operatorStatus');
        if (!operator.authenticated) { $('live-auth-panel').hidden = false; $('live-auth-status').textContent = 'Enter the operator password to unlock controls.'; status('Operator password required'); e.delivery.textContent = 'Locked'; emitHubState(false); return; }
        hubLocked = false;
      } else {
        client = window.CaptionsLive.createSupabase(window); if (!client) throw new Error('Operator authentication is unavailable'); access = await window.CaptionsLive.accessToken(client);
        $('live-auth-form').onsubmit = async event => { event.preventDefault(); $('live-auth-status').textContent = 'Sending secure sign-in link...'; try { const result = await client.auth.signInWithOtp({ email: $('live-auth-email').value.trim(), options: { emailRedirectTo: location.href } }); if (result.error) throw result.error; $('live-auth-status').textContent = 'Check your email for the sign-in link.'; } catch (error) { $('live-auth-status').textContent = window.CaptionsLive.cleanError(error.message, 'Sign-in failed'); } };
        if (!access) { $('live-auth-panel').hidden = false; $('live-auth-status').textContent = 'Sign in with your existing admin account.'; throw new Error('Operator sign-in required'); }
      }
      await initializeAuthorized();
    } catch (error) { if (hub && error?.status === 401 && error?.code === 'HUB_UNAUTHENTICATED') lockHub('Your wedding-party session expired. Local capture has stopped. Sign in to the wedding-party hub again; if captions were running, unlock the operator controls and reconnect or close that open run.', true); else { setEnabled(false); status(error.message, 'ended'); e.delivery.textContent = 'Unavailable'; } }
  }
  if (live) void liveMode(); else previewMode();
}());
