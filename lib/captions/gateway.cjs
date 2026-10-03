'use strict';

const { randomUUID } = require('node:crypto');
const {
  TARGET_LANGUAGES, FRAME_MS, FRAME_SAMPLES, decodeClientMessage, captionBatch, errorEvent, ProtocolError,
} = require('./protocol.cjs');
const { TurnBoundaryDetector, pcmBufferToInt16 } = require('./asr.cjs');
const { TranslationLanes, QueueFullError } = require('./queue.cjs');
const { guestPayload } = require('./delivery.cjs');

const DEFAULT_CONFIG = Object.freeze({
  authTimeoutMs: 5000,
  heartbeatMs: 10000,
  rotateAfterMs: 240000,
  shutdownAfterMs: 285000,
  translationConcurrency: 2,
  translationMaxQueued: 24,
  provisionalMinIntervalMs: 1200,
  provisionalMaxPerSegment: 2,
  translationWarningMs: 10000,
  leaseRenewMs: 30000,
  backgroundTaskTimeoutMs: 8000,
  turnMinMs: 300,
  turnSilenceMs: 450,
  turnMaxMs: 6000,
  commitMode: 'pause',
  fixedCommitMs: 4000,
  vadRmsThreshold: 0.012,
});

function withTimeout(promise, timeoutMs, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), timeoutMs);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

class SupabaseBroadcastPublisher {
  constructor({ supabaseUrl, serviceRoleKey, fetchImpl = global.fetch, guestSigner = null }) {
    if (!supabaseUrl || !serviceRoleKey || typeof fetchImpl !== 'function') throw new TypeError('Supabase publisher configuration is incomplete');
    this.url = `${supabaseUrl.replace(/\/+$/, '')}/realtime/v1/api/broadcast`;
    this.key = serviceRoleKey;
    this.fetch = fetchImpl;
    this.guestSigner = guestSigner;
  }

  async publish(topic, event, payload) {
    const messages = [{ topic, event, payload, private: true }];
    const guest = this.guestSigner ? /^caption:([^:]+):([^:]+)$/.exec(topic) : null;
    if (guest) {
      const guestTopic = this.guestSigner.topicFor(guest[1], guest[2]);
      // Outbox rows carry internal fields such as _fencingToken; guests get the batch HTTP delivery would send.
      messages.push({ topic: guestTopic, event, private: false,
        payload: this.guestSigner.envelope(guestTopic, event === 'caption.batch' ? guestPayload(payload) : payload) });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 5000);
    try {
      const response = await this.fetch(this.url, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ messages }),
      });
      if (!response.ok) throw Object.assign(new Error('Caption broadcast failed'), { code: 'broadcast_failed' });
    } catch (error) {
      if (error?.code === 'broadcast_failed') throw error;
      throw Object.assign(new Error('Caption broadcast failed'), { code: 'broadcast_failed' });
    } finally { clearTimeout(timeout); }
  }
}

class CaptionGateway {
  constructor({ store, asrFactory, translator, scriptAssistant = null, publisher, config = {}, allowedOrigins = [], clock = Date, idFactory = randomUUID }) {
    if (!store || typeof asrFactory !== 'function' || !translator || !publisher) throw new TypeError('Gateway dependencies are incomplete');
    this.store = store;
    this.asrFactory = asrFactory;
    this.translator = translator;
    this.scriptAssistant = scriptAssistant;
    this.publisher = publisher;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.allowedOrigins = new Set(allowedOrigins);
    this.clock = clock;
    this.idFactory = idFactory;
  }

  acceptsOrigin(origin) {
    return typeof origin === 'string' && this.allowedOrigins.has(origin);
  }

  attach(socket, { origin }) {
    const session = new GatewaySession({ gateway: this, socket, origin });
    session.start();
    return session;
  }
}

class GatewaySession {
  constructor({ gateway, socket, origin }) {
    this.gateway = gateway;
    this.socket = socket;
    this.origin = origin;
    this.authenticated = false;
    this.closed = false;
    this.messageSeq = new Map(TARGET_LANGUAGES.map(language => [language, 0]));
    this.sequenceRanges = new Map(TARGET_LANGUAGES.map(language => [language, []]));
    this.expectedFrame = null;
    this.turnStartSample = null;
    this.sourceByItem = new Map();
    this.reservedSegments = new Map();
    this.sourceHistory = [];
    this.abortControllers = new Set();
    this.approvedReviewProgress = new Map();
    this.failedDeliveries = new Set();
    this.unsavedSources = new Map();
    this.finalFailures = new Set();
    this.translationWork = new Set();
    const fixed = gateway.config.commitMode === 'fixed';
    this.detector = new TurnBoundaryDetector({
      minTurnMs: gateway.config.turnMinMs,
      silenceMs: fixed ? gateway.config.fixedCommitMs + 1 : gateway.config.turnSilenceMs,
      maxTurnMs: fixed ? gateway.config.fixedCommitMs : gateway.config.turnMaxMs,
      rmsThreshold: gateway.config.vadRmsThreshold,
    });
    this.lanes = new TranslationLanes({
      languages: TARGET_LANGUAGES,
      concurrency: gateway.config.translationConcurrency,
      maxQueued: gateway.config.translationMaxQueued,
      worker: (language, job) => this.translate(language, job),
    });
    this.processing = Promise.resolve();
  }

  start() {
    if (!this.gateway.acceptsOrigin(this.origin)) {
      this.safeSend(errorEvent('origin_denied', 'This origin is not allowed'));
      this.close(1008, 'origin denied');
      return;
    }
    this.authTimer = setTimeout(() => {
      if (!this.authenticated) {
        this.safeSend(errorEvent('auth_timeout', 'Authentication was not received in time'));
        this.close(1008, 'auth timeout');
      }
    }, this.gateway.config.authTimeoutMs);
    this.socket.on('message', raw => {
      this.processing = this.processing.then(() => this.onMessage(raw)).catch(error => this.handleError(error));
    });
    this.socket.on('close', () => this.stop('client_disconnected'));
    this.socket.on('error', () => this.stop('socket_error'));
  }

  async onMessage(raw) {
    if (this.closed) return;
    const message = decodeClientMessage(raw);
    if (!this.authenticated) {
      if (message.type !== 'auth') throw new ProtocolError('auth_required', 'The first message must authenticate');
      try { await this.authenticate(message.ticket); } catch (error) {
        // A half-authenticated session has no timers left to end it and may hold an open ASR socket.
        this.handleError(error);
        if (!this.closed) this.close(1011, error?.code ?? 'gateway_error');
      }
      return;
    }
    if (message.type === 'auth') throw new ProtocolError('already_authenticated', 'This connection is already authenticated');
    if (message.type === 'drain') {
      void this.drainForTransition(message.reason);
      return;
    }
    await this.receiveAudio(message);
  }

  async authenticate(ticket) {
    const auth = await this.gateway.store.consumeUplinkTicket({ token: ticket, origin: this.origin });
    if (this.closed) return;
    this.context = auth;
    const state = await this.gateway.store.getRunState({ runId: auth.runId });
    if (this.closed) return;
    const runStatus = state?.status ?? state?.state;
    if (!state || state.modeGeneration !== auth.modeGeneration || state.fencingToken !== auth.fencingToken || !['live', 'degraded', 'starting'].includes(runStatus)) {
      throw Object.assign(new Error('The caption run is not active'), { code: 'stale_ticket' });
    }
    const runtime = typeof this.gateway.store.getRuntimeContext === 'function'
      ? await this.gateway.store.getRuntimeContext({ runId: auth.runId, modeGeneration: auth.modeGeneration, fencingToken: auth.fencingToken })
      : state;
    if (this.closed) return;
    this.scriptCues = Array.isArray(runtime?.scripts) ? runtime.scripts : Array.isArray(runtime?.scriptCues) ? runtime.scriptCues : [];
    this.glossary = Array.isArray(runtime?.glossary) ? runtime.glossary : [];
    for (const [language, sequence] of Object.entries(runtime?.messageSeqByLanguage ?? {})) {
      if (TARGET_LANGUAGES.includes(language) && Number.isSafeInteger(sequence)) this.messageSeq.set(language, sequence);
    }
    this.sourceHistory = (runtime?.recentSources ?? []).filter(source => source && Number.isSafeInteger(source.segmentOrder) && source.text)
      .sort((left, right) => left.segmentOrder - right.segmentOrder).slice(-20);
    await this.reserveSequenceBlock();
    if (this.closed) return;
    const asr = this.gateway.asrFactory({ context: auth, glossary: this.glossary });
    this.asr = asr;
    try {
      await asr.open(event => {
        this.processing = this.processing.then(() => this.onAsrEvent(event)).catch(error => this.handleError(error));
      });
    } catch (error) { await Promise.resolve(asr.close()).catch(() => undefined); throw error; }
    if (this.closed) { await Promise.resolve(asr.close()).catch(() => undefined); return; }
    this.authenticated = true;
    clearTimeout(this.authTimer);
    const recovered = await this.gateway.store.recoverPending({ runId: auth.runId, limit: 100 });
    if (this.closed) { await Promise.resolve(asr.close()).catch(() => undefined); return; }
    for (const source of recovered?.finalSources ?? []) this.enqueueRecoveredSource(source);
    await this.flushOutbox();
    if (this.closed) { await Promise.resolve(asr.close()).catch(() => undefined); return; }
    // The run can be stopped over HTTP while ASR opens, before this socket's close arrives.
    const current = await this.isCurrent(auth);
    if (this.closed) { await Promise.resolve(asr.close()).catch(() => undefined); return; }
    if (!current) {
      await Promise.resolve(asr.close()).catch(() => undefined);
      throw Object.assign(new Error('The caption run is not active'), { code: 'stale_ticket' });
    }
    this.safeSend({ type: 'ready', eventId: auth.eventId, runId: auth.runId, modeGeneration: auth.modeGeneration,
      channelEpoch: auth.channelEpoch, frameMs: FRAME_MS, sampleRate: 24000, rotateAfterMs: this.gateway.config.rotateAfterMs });
    this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), this.gateway.config.heartbeatMs);
    this.leaseTimer = setInterval(() => void this.renewLease(), this.gateway.config.leaseRenewMs);
    this.rotateTimer = setTimeout(() => void this.prepareRotation(), this.gateway.config.rotateAfterMs);
    this.shutdownTimer = setTimeout(() => this.close(1001, 'function_rotation'), this.gateway.config.shutdownAfterMs);
  }

  async receiveAudio(message) {
    if (!this.asr) throw Object.assign(new Error('ASR is unavailable'), { code: 'asr_unavailable' });
    if (this.rotating) {
      if (!this.rotationGapRecorded) {
        this.rotationGapRecorded = true;
        await this.recordGap(this.expectedFrame ? this.expectedFrame.sequence + 1 : 0, message.sequence, 'audio_during_rotation');
      }
      return;
    }
    if (!this.expectedFrame) {
      if (message.sequence !== 0 || message.sampleOffset !== 0) await this.recordGap(0, message.sequence, 'initial_offset');
      this.expectedFrame = { captureEpoch: message.captureEpoch, sequence: message.sequence, sampleOffset: message.sampleOffset };
    } else {
      if (message.captureEpoch !== this.expectedFrame.captureEpoch) {
        await this.recordGap(this.expectedFrame.sequence + 1, message.sequence, 'capture_epoch_changed');
        throw Object.assign(new Error('Capture epoch changed without reconnecting'), { code: 'capture_epoch_changed' });
      }
      const expectedSequence = this.expectedFrame.sequence + 1;
      const expectedOffset = this.expectedFrame.sampleOffset + FRAME_SAMPLES;
      if (message.sequence < expectedSequence || message.sampleOffset < expectedOffset) return;
      if (message.sequence !== expectedSequence || message.sampleOffset !== expectedOffset) {
        await this.recordGap(expectedSequence, message.sequence, 'audio_sequence_gap');
      }
      this.expectedFrame = { captureEpoch: message.captureEpoch, sequence: message.sequence, sampleOffset: message.sampleOffset };
    }
    if (this.turnStartSample === null) this.turnStartSample = message.sampleOffset;
    this.asr.append(message.audio);
    const boundary = this.detector.add(pcmBufferToInt16(message.audio));
    if (boundary === 'commit') {
      await this.commitTurn({ captureEpoch: message.captureEpoch, captureStartSample: this.turnStartSample,
        captureEndSample: message.sampleOffset + FRAME_SAMPLES });
      this.turnStartSample = null;
    } else if (boundary === 'discard') {
      this.asr.clear();
      this.turnStartSample = null;
    }
  }

  async commitTurn(capture = {}) {
    const reserved = await this.gateway.store.reserveSegmentOrder({ runId: this.context.runId,
      modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken });
    const reservation = { ...reserved, ...capture, committedAt: performance.now() };
    if (this.closed) {
      const source = { ...reservation, itemId: null, text: '', sourceRevision: 0, draftCount: 0, lastDraftAt: 0, final: false };
      await this.persistUnavailableSource(source, 'connection_closed_during_reservation', { throwOnFailure: true }).catch(async () => {
        await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'asr_gap',
          detailsSafe: { reason: 'connection_closed_during_reservation', segmentId: source.segmentId,
            segmentOrder: source.segmentOrder } }).catch(() => undefined);
      });
      return;
    }
    this.reservedSegments.set(reserved.segmentOrder, reservation);
    this.asr.commit(reserved.segmentOrder);
  }

  enqueueRecoveredSource(row) {
    if (!row?.segmentId || !Number.isSafeInteger(row.segmentOrder) || !Number.isSafeInteger(row.sourceRevision) || !row.text) return;
    const source = { itemId: row.providerItemId ?? null, segmentId: row.segmentId, segmentOrder: row.segmentOrder,
      sourceRevision: row.sourceRevision, text: row.text, final: true, draftCount: 0, lastDraftAt: 0 };
    this.sourceHistory = [...this.sourceHistory.filter(item => item.segmentId !== source.segmentId), source]
      .sort((left, right) => left.segmentOrder - right.segmentOrder).slice(-20);
    this.enqueueTranslations(source, 'final', { recovered: true });
  }

  commitTail() {
    if (this.detector.hasUnconfirmedSpeech()) {
      const capture = { captureEpoch: this.expectedFrame?.captureEpoch,
        captureStartSample: this.turnStartSample,
        captureEndSample: this.expectedFrame ? this.expectedFrame.sampleOffset + FRAME_SAMPLES : null };
      // Reset before the reservation is awaited so rotation and End can never commit one tail twice.
      this.detector.reset();
      this.turnStartSample = null;
      this.tailCommit = this.commitTurn(capture);
    }
    return this.tailCommit;
  }

  async prepareRotation() {
    if (this.closed || !this.authenticated || this.rotating) return;
    this.rotating = true;
    this.safeSend({ type: 'status', status: 'rotation.preparing' });
    try {
      // A frame may still be reserving its turn; let it commit before the drain check counts turns.
      await withTimeout(this.processing, 5000, 'rotation_checkpoint_timeout');
      await this.commitTail();
      await this.asr.drain(5000);
      await withTimeout(this.processing, 5000, 'rotation_checkpoint_timeout');
    } catch {
      await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'stream_gap',
        detailsSafe: { reason: 'rotation_tail_unconfirmed' } }).catch(() => undefined);
      this.safeSend({ type: 'status', status: 'stream.gap', reason: 'rotation_tail_unconfirmed' });
    }
    this.safeSend({ type: 'rotate', reason: 'function_duration', reconnectByMs: 15000 });
  }

  async drainForTransition(reason) {
    if (this.drainingTransition) return;
    this.drainingTransition = reason;
    this.rotating = true;
    this.endDelivery = null;
    let withGap = false;
    try {
      // A tail that rotation is already committing is reported by that path; wait for it, never commit it again.
      if (this.tailCommit) await this.tailCommit.catch(() => { withGap = true; });
      else await this.commitTail();
      await this.asr.drain(5000);
      await this.processing;
      // Idle lanes can still have failure handling in flight; it decides what End must report.
      await withTimeout(this.lanes.onIdle().then(() => Promise.all(this.translationWork)), 20000, 'end_drain_timeout');
      const delivery = await this.flushOutbox();
      if (delivery.failed > 0 || this.failedDeliveries.size > 0) {
        withGap = true;
        await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'stream_gap',
          detailsSafe: { reason: `${reason}_delivery_failed`, failedCount: this.failedDeliveries.size } }).catch(() => undefined);
        this.safeSend({ type: 'status', status: 'stream.gap', reason: `${reason}_delivery_failed` });
      }
      if (this.finalFailures.size > 0 || this.unsavedSources.size > 0) {
        withGap = true;
        await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'stream_gap',
          detailsSafe: { reason: `${reason}_caption_failures`, captions: this.finalFailures.size,
            sources: this.unsavedSources.size } }).catch(() => undefined);
        this.safeSend({ type: 'status', status: 'stream.gap', reason: `${reason}_caption_failures` });
      }
      this.endDelivery = { ...delivery, unresolvedFailed: this.failedDeliveries.size };
    } catch {
      withGap = true;
      await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'stream_gap',
        detailsSafe: { reason: `${reason}_drain_timeout` } }).catch(() => undefined);
      this.safeSend({ type: 'status', status: 'stream.gap', reason: `${reason}_drain_timeout` });
    }
    this.safeSend({ type: 'status', status: 'drained', reason, withGap,
      delivery: this.endDelivery ?? { attempted: 0, delivered: 0, failed: this.failedDeliveries.size, unresolvedFailed: this.failedDeliveries.size },
      failures: { captions: this.finalFailures.size, sources: this.unsavedSources.size } });
  }

  async recordGap(expectedSequence, receivedSequence, reason) {
    this.safeSend({ type: 'status', status: 'stream.gap', expectedSequence, receivedSequence, reason });
    if (this.context) await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'stream_gap',
      detailsSafe: { expectedSequence, receivedSequence, reason } });
  }

  async onAsrEvent(event) {
    if (this.closed || !this.context) return;
    if (event.type === 'committed') {
      const reservation = this.reservedSegments.get(event.segmentOrder);
      if (!reservation) throw Object.assign(new Error('ASR committed an unreserved segment'), { code: 'unreserved_segment' });
      this.reservedSegments.delete(event.segmentOrder);
      this.sourceByItem.set(event.itemId, { itemId: event.itemId, segmentId: reservation.segmentId,
        segmentOrder: event.segmentOrder, captureEpoch: reservation.captureEpoch,
        captureStartSample: reservation.captureStartSample, captureEndSample: reservation.captureEndSample,
        committedAt: reservation.committedAt, text: '', sourceRevision: 0, draftCount: 0, lastDraftAt: 0, final: false });
      return;
    }
    if (event.type === 'failed') {
      this.safeSend({ type: 'status', status: 'asr.error', code: event.code });
      if (event.itemId && this.sourceByItem.has(event.itemId)) await this.persistUnavailableSource(this.sourceByItem.get(event.itemId), event.code);
      else {
        try {
          await this.gateway.store.recordOperationalEvent({ runId: this.context.runId,
            type: 'asr_gap', detailsSafe: { code: event.code } });
        } finally {
          // No itemId means the provider session itself failed: later audio would be discarded, so end
          // the connection and let the operator client reconnect.
          if (!event.itemId) {
            this.safeSend(errorEvent('asr_unavailable', 'Speech recognition disconnected; reconnect to continue.', true));
            this.close(1011, 'asr_unavailable');
          }
        }
      }
      return;
    }
    const source = this.sourceByItem.get(event.itemId);
    if (!source || source.final) return;
    if (event.type === 'delta') {
      source.text = event.snapshot;
      const now = this.gateway.clock.now();
      if (source.text.trim().length >= 3 && source.draftCount < this.gateway.config.provisionalMaxPerSegment &&
        now - source.lastDraftAt >= this.gateway.config.provisionalMinIntervalMs) {
        source.sourceRevision += 1;
        source.draftCount += 1;
        source.lastDraftAt = now;
        const snapshot = { ...source };
        this.publishSource(snapshot, 'draft');
        this.enqueueTranslations(snapshot, 'draft');
      }
      return;
    }
    source.final = true;
    source.text = event.transcript.trim();
    source.sourceRevision += 1;
    void this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'asr_timing', detailsSafe: {
      segmentId: source.segmentId, segmentOrder: source.segmentOrder,
      durationMs: Math.max(0, performance.now() - source.committedAt), captureStartSample: source.captureStartSample,
      captureEndSample: source.captureEndSample,
    } }).catch(() => undefined);
    if (!source.text) return;
    const snapshot = { ...source };
    try {
      await this.gateway.store.checkpointSource({ runId: this.context.runId, modeGeneration: this.context.modeGeneration,
        fencingToken: this.context.fencingToken, sourceSegment: this.sourceRecord(snapshot, 'final') });
    } catch {
      this.unsavedSources.set(snapshot.segmentId, snapshot);
      this.safeSend({ type: 'status', status: 'database.degraded' });
    }
    this.sourceHistory = [...this.sourceHistory.filter(item => item.segmentId !== snapshot.segmentId), snapshot]
      .sort((left, right) => left.segmentOrder - right.segmentOrder).slice(-20);
    this.publishSource(snapshot, 'final');
    this.enqueueTranslations(snapshot, 'final');
    void this.reviewScript(snapshot);
  }

  publishSource(source, status) {
    this.safeSend({ type: 'source', runId: this.context.runId, modeGeneration: this.context.modeGeneration,
      segmentId: source.segmentId, segmentOrder: source.segmentOrder, sourceRevision: source.sourceRevision,
      status, text: source.text });
  }

  async persistUnavailableSource(source, code, { throwOnFailure = false } = {}) {
    if (!source || source.final) return;
    source.final = true;
    source.sourceRevision = Math.max(1, source.sourceRevision + 1);
    const payloads = [];
    for (const language of TARGET_LANGUAGES) {
      const update = { segmentId: source.segmentId, segmentOrder: source.segmentOrder,
        sourceRevision: source.sourceRevision, captionRevision: source.sourceRevision,
        language, status: 'unavailable', origin: 'ai_live', text: '' };
      payloads.push({ language, idempotencyKey: `${source.segmentId}:${language}:${source.sourceRevision}:asr-unavailable`,
        payload: await this.makeBatch(language, [update]) });
    }
    try {
      await this.gateway.store.persistFinalAndEnqueue({ runId: this.context.runId,
        modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken,
        sourceSegment: this.sourceRecord(source, 'unavailable'), captions: payloads.map(item => item.payload.updates[0]),
        payloads, idempotencyKey: `${source.segmentId}:${source.sourceRevision}:asr-unavailable` });
      await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'asr_gap',
        detailsSafe: { segmentId: source.segmentId, segmentOrder: source.segmentOrder, code } });
      await this.flushOutbox();
    } catch (error) {
      this.safeSend({ type: 'status', status: 'database.degraded' });
      if (throwOnFailure) throw error;
    }
  }

  enqueueTranslations(source, status, extras = {}) {
    const orderedContext = this.sourceHistory.filter(candidate => candidate.segmentOrder < source.segmentOrder)
      .sort((left, right) => left.segmentOrder - right.segmentOrder).slice(-5).map(candidate => candidate.text);
    for (const language of TARGET_LANGUAGES) {
      const job = { source, status, context: orderedContext, modeGeneration: this.context.modeGeneration,
        fencingToken: this.context.fencingToken, ...extras };
      const work = this.lanes.enqueue(language, job, { priority: status === 'final' ? 10 : 0,
        key: source.segmentId, replaceQueued: true }).catch(error => this.translationFailure(language, job, error)
        .catch(() => this.safeSend({ type: 'status', status: 'database.degraded' })));
      this.translationWork.add(work);
      void work.then(() => this.translationWork.delete(work));
    }
  }

  async translate(language, job) {
    if (!(await this.isCurrent(job))) return { dropped: true, reason: 'stale_generation' };
    const translationStartedAt = performance.now();
    const controller = new AbortController();
    this.abortControllers.add(controller);
    const warning = setTimeout(() => this.safeSend({ type: 'status', status: 'translation.delayed', language,
      segmentId: job.source.segmentId }), this.gateway.config.translationWarningMs);
    try {
      if (this.closed || controller.signal.aborted) return { dropped: true, reason: 'stale_generation' };
      const result = await this.gateway.translator.translate({ language, currentSegment: job.source.text,
        context: job.context, glossary: this.glossary, signal: controller.signal });
      void this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'translation_timing', detailsSafe: {
        segmentId: job.source.segmentId, segmentOrder: job.source.segmentOrder, sourceRevision: job.source.sourceRevision,
        language, status: job.status, durationMs: Math.max(0, performance.now() - translationStartedAt),
        inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
      } }).catch(() => undefined);
      if (!(await this.isCurrent(job))) return { dropped: true, reason: 'stale_generation' };
      const update = { segmentId: job.source.segmentId, segmentOrder: job.source.segmentOrder,
        sourceRevision: job.source.sourceRevision, captionRevision: job.source.sourceRevision,
        language, status: job.status, origin: 'ai_live', text: result.text };
      if (job.status === 'draft') {
        // This sequence came from a block reserved under the current fence, allowing
        // the draft to reach guests before its best-effort database checkpoint.
        if (!(await this.isCurrent(job))) return { dropped: true, reason: 'stale_generation' };
        const payload = await this.makeBatch(language, [update]);
        await this.gateway.publisher.publish(`caption:${this.context.eventId}:${language}`, 'caption.batch', payload);
        this.safeSend(payload);
        void this.gateway.store.checkpointDraft({ runId: this.context.runId,
          modeGeneration: job.modeGeneration, fencingToken: job.fencingToken,
          segment: this.sourceRecord(job.source, 'draft'), captions: [{ ...update, messageSeq: payload.messageSeq }],
        }).catch(() => this.safeSend({ type: 'status', status: 'database.degraded' }));
      } else {
        const payload = await this.makeBatch(language, [update]);
        await this.gateway.store.persistFinalAndEnqueue({ runId: this.context.runId, modeGeneration: job.modeGeneration,
          fencingToken: job.fencingToken, sourceSegment: this.sourceRecord(job.source, 'final'), captions: [update],
          payloads: [{ language, idempotencyKey: `${job.source.segmentId}:${language}:${job.source.sourceRevision}`, payload }],
          idempotencyKey: `${job.source.segmentId}:${language}:${job.source.sourceRevision}` });
        this.unsavedSources.delete(job.source.segmentId);
        this.finalFailures.delete(`${job.source.segmentId}:${language}`);
        await this.flushOutbox();
        await this.markApprovedLanguage(job, language);
      }
      return { dropped: false };
    } finally {
      clearTimeout(warning);
      this.abortControllers.delete(controller);
    }
  }

  sourceRecord(source, status) {
    return { segmentId: source.segmentId, segmentOrder: source.segmentOrder, sourceRevision: source.sourceRevision,
      captureEpoch: source.captureEpoch ?? null, captureStartSample: source.captureStartSample ?? null,
      captureEndSample: source.captureEndSample ?? null, providerItemId: source.itemId, status, text: source.text };
  }

  async translationFailure(language, job, error) {
    if (this.closed || error?.code === 'queue_closed' || error?.code === 'stale_generation') return;
    const code = error instanceof QueueFullError ? 'translation_queue_full' : error?.code ?? 'translation_failed';
    this.safeSend({ type: 'status', status: 'translation.error', language, segmentId: job.source.segmentId, code });
    if (job.status !== 'final') return;
    // Counted before the fence read: if that read itself fails, End must still report this caption.
    const failureKey = `${job.source.segmentId}:${language}`;
    this.finalFailures.add(failureKey);
    if (!(await this.isCurrent(job))) { this.finalFailures.delete(failureKey); return; }
    if (job.approvedReviewId) {
      await this.gateway.store.completeApprovedReview({ reviewId: job.approvedReviewId,
        workerId: `gateway:${this.context.channelEpoch}`, error: { code } }).catch(() => undefined);
    }
    const update = { segmentId: job.source.segmentId, segmentOrder: job.source.segmentOrder,
      sourceRevision: job.source.sourceRevision, captionRevision: job.source.sourceRevision,
      language, status: 'unavailable', origin: 'ai_live', text: '' };
    const payload = await this.makeBatch(language, [update]);
    try {
      await this.gateway.store.persistFinalAndEnqueue({ runId: this.context.runId, modeGeneration: job.modeGeneration,
        fencingToken: job.fencingToken, sourceSegment: this.sourceRecord(job.source, 'final'), captions: [update],
        payloads: [{ language, idempotencyKey: `${job.source.segmentId}:${language}:${job.source.sourceRevision}:unavailable`, payload }],
        idempotencyKey: `${job.source.segmentId}:${language}:${job.source.sourceRevision}:unavailable` });
      this.unsavedSources.delete(job.source.segmentId);
      await this.flushOutbox();
    } catch {
      this.safeSend({ type: 'status', status: 'database.degraded' });
    }
  }

  async makeBatch(language, updates) {
    const next = await this.nextMessageSequence(language);
    this.messageSeq.set(language, next);
    return captionBatch({ eventId: this.context.eventId, runId: this.context.runId,
      modeGeneration: this.context.modeGeneration, channelEpoch: this.context.channelEpoch,
      messageSeq: next, language, publishedAt: this.gateway.clock.now(), updates });
  }

  async reserveSequenceBlock() {
    if (this.sequenceReservationPromise) return this.sequenceReservationPromise;
    this.sequenceReservationPromise = this.gateway.store.reserveMessageSequenceBlock({ runId: this.context.runId,
      modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken, size: 128 }).then(block => {
      if (block.channelEpoch !== this.context.channelEpoch) throw Object.assign(new Error('Sequence epoch changed'), { code: 'stale_ticket' });
      for (const language of TARGET_LANGUAGES) {
        const range = block.ranges?.[language];
        if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start > range.end) {
          throw Object.assign(new Error('Invalid sequence reservation'), { code: 'sequence_reservation_failed' });
        }
        this.sequenceRanges.get(language).push({ next: range.start, end: range.end });
      }
    }).finally(() => { this.sequenceReservationPromise = null; });
    return this.sequenceReservationPromise;
  }

  async nextMessageSequence(language) {
    let ranges = this.sequenceRanges.get(language);
    while (ranges?.length && ranges[0].next > ranges[0].end) ranges.shift();
    if (!ranges?.length) {
      await this.reserveSequenceBlock();
      ranges = this.sequenceRanges.get(language);
    }
    const value = ranges[0].next;
    ranges[0].next += 1;
    return value;
  }

  async reviewScript(source) {
    if (!this.gateway.scriptAssistant || !this.scriptCues.length || this.closed) return;
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      const review = await this.gateway.scriptAssistant.review({ rawText: source.text,
        prior: this.sourceHistory.filter(item => item.segmentOrder < source.segmentOrder)
          .sort((left, right) => left.segmentOrder - right.segmentOrder).slice(-3).map(item => item.text),
        scriptCues: this.scriptCues, signal: controller.signal });
      if (review && !this.closed && await this.isCurrent({ modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken })) {
        let reviewId = null;
        if (review.reviewable) {
          const stored = await this.gateway.store.recordScriptReview({ runId: this.context.runId,
            segmentId: source.segmentId, segmentOrder: source.segmentOrder, sourceRevision: source.sourceRevision,
            originalText: source.text, proposedText: review.suggestedText,
            matchedScriptId: review.matchedScriptId, providerItemId: source.itemId });
          reviewId = stored?.reviewId ?? null;
        }
        this.safeSend({ type: 'review', runId: this.context.runId, modeGeneration: this.context.modeGeneration,
          reviewId, segmentId: source.segmentId, sourceRevision: source.sourceRevision, rawText: source.text,
          proposedText: review.suggestedText, matchedCueIds: review.matchedCueIds, explanation: review.explanation,
          reviewable: review.reviewable, rejectionReason: review.rejectionReason });
      }
    } catch {
      this.safeSend({ type: 'status', status: 'script.review_unavailable', segmentId: source.segmentId });
    } finally { this.abortControllers.delete(controller); }
  }

  async isCurrent(job) {
    if (this.closed || !this.context || job.modeGeneration !== this.context.modeGeneration || job.fencingToken !== this.context.fencingToken) return false;
    const context = this.context;
    const state = await this.gateway.store.getRunState({ runId: context.runId });
    if (this.closed || this.context !== context || job.modeGeneration !== context.modeGeneration || job.fencingToken !== context.fencingToken) return false;
    const status = state?.status ?? state?.state;
    return Boolean(state && ['live', 'degraded', 'starting'].includes(status) && state.modeGeneration === job.modeGeneration && state.fencingToken === job.fencingToken);
  }

  async heartbeat() {
    if (this.closed || !this.context) return;
    this.safeSend({ type: 'status', status: 'heartbeat', runId: this.context.runId,
      messageSeqByLanguage: Object.fromEntries(this.messageSeq), at: new Date(this.gateway.clock.now()).toISOString() });
    const state = await this.gateway.store.getRunState({ runId: this.context.runId });
    const status = state?.status ?? state?.state ?? 'disconnected';
    await Promise.all(TARGET_LANGUAGES.map(language => this.gateway.publisher.publish(
      `caption:${this.context.eventId}:${language}`, 'heartbeat', { type: 'heartbeat', eventId: this.context.eventId,
        runId: this.context.runId, modeGeneration: this.context.modeGeneration, channelEpoch: this.context.channelEpoch,
        language, messageSeq: this.messageSeq.get(language) ?? 0, status,
        publishedAt: new Date(this.gateway.clock.now()).toISOString() })));
    await this.pollApprovedReviews().catch(() => this.safeSend({ type: 'status', status: 'script.review_sync_delayed' }));
    await this.flushOutbox().catch(() => this.safeSend({ type: 'status', status: 'broadcast.degraded' }));
  }

  async runHeartbeat() {
    if (this.closed || this.heartbeatRunning) return;
    this.heartbeatRunning = true;
    try {
      await withTimeout(this.heartbeat(), this.gateway.config.backgroundTaskTimeoutMs, 'heartbeat_timeout');
    } catch (error) {
      this.safeSend({ type: 'status', status: 'broadcast.degraded', code: error?.code ?? 'heartbeat_failed' });
      if (this.context) await withTimeout(this.gateway.store.recordOperationalEvent({ runId: this.context.runId,
        type: 'heartbeat_failed', detailsSafe: { code: error?.code ?? 'heartbeat_failed' } }),
      this.gateway.config.backgroundTaskTimeoutMs, 'heartbeat_record_timeout').catch(() => undefined);
    } finally { this.heartbeatRunning = false; }
  }

  async renewLease() {
    if (this.closed || !this.context) return;
    try {
      await this.gateway.store.renewPublisherLease({ runId: this.context.runId,
        modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken });
    } catch {
      this.safeSend(errorEvent('publisher_lease_lost', 'The active publisher lease was lost'));
      this.close(1008, 'publisher lease lost');
    }
  }

  async pollApprovedReviews() {
    if (this.closed || !this.context || typeof this.gateway.store.claimApprovedReviews !== 'function') return;
    const workerId = `gateway:${this.context.channelEpoch}`;
    const rows = await this.gateway.store.claimApprovedReviews({ runId: this.context.runId,
      modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken, workerId, limit: 10 });
    for (const row of rows ?? []) {
      if (!row.reviewId || !row.segmentId || !Number.isSafeInteger(row.segmentOrder) || !Number.isSafeInteger(row.sourceRevision)) {
        if (row.reviewId) await this.gateway.store.completeApprovedReview({ reviewId: row.reviewId, workerId,
          error: { code: 'invalid_approved_review' } });
        continue;
      }
      this.approvedReviewProgress.set(row.reviewId, { workerId, languages: new Set() });
      const source = { itemId: row.providerItemId ?? null, segmentId: row.segmentId, segmentOrder: row.segmentOrder,
        sourceRevision: row.sourceRevision + 1, text: row.proposedText, final: true, draftCount: 0, lastDraftAt: 0 };
      await this.gateway.store.checkpointSource({ runId: this.context.runId,
        modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken,
        sourceSegment: this.sourceRecord(source, 'corrected') });
      this.sourceHistory = [...this.sourceHistory.filter(item => item.segmentId !== source.segmentId), source]
        .sort((left, right) => left.segmentOrder - right.segmentOrder).slice(-20);
      this.publishSource(source, 'corrected');
      this.enqueueTranslations(source, 'final', { approvedReviewId: row.reviewId });
    }
  }

  async markApprovedLanguage(job, language) {
    if (!job.approvedReviewId) return;
    const progress = this.approvedReviewProgress.get(job.approvedReviewId);
    if (!progress) return;
    progress.languages.add(language);
    if (progress.languages.size === TARGET_LANGUAGES.length) {
      await this.gateway.store.completeApprovedReview({ reviewId: job.approvedReviewId,
        workerId: progress.workerId, error: null });
      this.approvedReviewProgress.delete(job.approvedReviewId);
    }
  }

  async flushOutbox() {
    const outcome = { attempted: 0, delivered: 0, failed: 0 };
    if (!this.context || this.closed) return outcome;
    const state = await this.gateway.store.getRunState({ runId: this.context.runId });
    const status = state?.status ?? state?.state;
    if (!state || !['live', 'degraded', 'starting'].includes(status) ||
      state.modeGeneration !== this.context.modeGeneration || state.fencingToken !== this.context.fencingToken) return outcome;
    const workerId = `gateway:${this.context.channelEpoch}`;
    const rows = await this.gateway.store.claimOutbox({ runId: this.context.runId,
      modeGeneration: this.context.modeGeneration, fencingToken: this.context.fencingToken, limit: 50, workerId });
    for (const row of rows ?? []) {
      outcome.attempted += 1;
      const outboxId = row.outboxId ?? row.id;
      try {
        if (row.payload?.modeGeneration !== this.context.modeGeneration || row.payload?.channelEpoch !== this.context.channelEpoch) {
          await this.gateway.store.completeOutbox({ outboxId, workerId, error: null });
          this.failedDeliveries.delete(outboxId); outcome.delivered += 1;
          continue;
        }
        if (Number.isSafeInteger(row.payload?.messageSeq)) {
          this.messageSeq.set(row.language, Math.max(this.messageSeq.get(row.language) ?? 0, row.payload.messageSeq));
        }
        await this.gateway.publisher.publish(`caption:${this.context.eventId}:${row.language}`, 'caption.batch', row.payload);
        this.safeSend(row.payload);
        await this.gateway.store.completeOutbox({ outboxId, workerId, error: null });
        this.failedDeliveries.delete(outboxId); outcome.delivered += 1;
      } catch {
        this.failedDeliveries.add(outboxId); outcome.failed += 1;
        await this.gateway.store.completeOutbox({ outboxId, workerId, error: { code: 'broadcast_failed' } });
        this.safeSend({ type: 'status', status: 'broadcast.degraded' });
      }
    }
    return outcome;
  }

  handleError(error) {
    const code = error?.code ?? 'gateway_error';
    const messages = {
      invalid_json: 'The client sent invalid JSON.', invalid_message: 'The client message was invalid.',
      invalid_audio: 'The audio frame was invalid.', invalid_audio_frame: 'The audio frame size was invalid.',
      message_too_large: 'The client message was too large.', unsupported_message: 'The client message type is unsupported.',
      auth_required: 'Authentication is required.', already_authenticated: 'This connection is already authenticated.',
      stale_ticket: 'The uplink ticket is no longer valid.', capture_epoch_changed: 'Reconnect before starting a new capture epoch.',
      publisher_lease_lost: 'The active publisher lease was lost.',
      asr_unavailable: 'Speech recognition disconnected; reconnect to continue.',
    };
    this.safeSend(errorEvent(code, messages[code] ?? 'The caption stream failed.',
      ['broadcast_failed', 'asr_connection', 'asr_unavailable'].includes(code)));
    if (['origin_denied', 'auth_required', 'auth_timeout', 'stale_ticket', 'capture_epoch_changed'].includes(code)) this.close(1008, code);
    else if (['asr_unavailable', 'asr_connection'].includes(code)) this.close(1011, code);
  }

  safeSend(payload) {
    if (this.closed || this.socket.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(payload)); return true; } catch { return false; }
  }

  close(code = 1000, reason = 'complete') {
    try { this.socket.close(code, reason); } catch { this.socket.terminate?.(); }
    this.stop(reason);
  }

  stop(reason = 'stopped') {
    if (this.closed) return;
    const unconfirmed = this.detector.hasUnconfirmedSpeech();
    const unfinished = [...this.sourceByItem.values()].filter(source => !source.final);
    for (const reservation of this.reservedSegments.values()) unfinished.push({ ...reservation, itemId: null,
      text: '', sourceRevision: 0, draftCount: 0, lastDraftAt: 0, final: false });
    const unsaved = [...this.unsavedSources.values()];
    this.sourceByItem.clear(); this.reservedSegments.clear(); this.unsavedSources.clear();
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.leaseTimer);
    clearTimeout(this.rotateTimer);
    clearTimeout(this.shutdownTimer);
    for (const controller of this.abortControllers) controller.abort(reason);
    this.abortControllers.clear();
    this.lanes.close();
    void Promise.resolve(this.asr?.close()).catch(() => undefined);
    this.stopPromise = this.persistStopGaps(reason, unconfirmed, unfinished, unsaved);
  }

  async persistStopGaps(reason, unconfirmed, unfinished, unsaved = []) {
    if (!this.context) return;
    if (unconfirmed) await this.gateway.store.recordOperationalEvent({ runId: this.context.runId,
      type: 'stream_gap', detailsSafe: { reason: 'unconfirmed_audio_on_close', closeReason: reason } }).catch(() => undefined);
    for (const source of unfinished) {
      await this.persistUnavailableSource(source, 'connection_closed_before_asr_final', { throwOnFailure: true }).catch(async () => {
        await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'asr_gap',
          detailsSafe: { reason: 'connection_closed_before_asr_final', segmentId: source.segmentId,
            segmentOrder: source.segmentOrder, closeReason: reason } }).catch(() => undefined);
      });
    }
    for (const source of unsaved) {
      await this.gateway.store.checkpointSource({ runId: this.context.runId, modeGeneration: this.context.modeGeneration,
        fencingToken: this.context.fencingToken, sourceSegment: this.sourceRecord(source, 'final') }).catch(async () => {
        await this.gateway.store.recordOperationalEvent({ runId: this.context.runId, type: 'asr_gap',
          detailsSafe: { reason: 'source_checkpoint_lost', segmentId: source.segmentId,
            segmentOrder: source.segmentOrder, closeReason: reason } }).catch(() => undefined);
      });
    }
  }
}

module.exports = { DEFAULT_CONFIG, SupabaseBroadcastPublisher, CaptionGateway, GatewaySession };
