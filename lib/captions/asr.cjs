'use strict';

const { FRAME_SAMPLES, PCM_SAMPLE_RATE } = require('./protocol.cjs');

class TurnBoundaryDetector {
  constructor({ minTurnMs = 300, maxTurnMs = 6000, silenceMs = 450, rmsThreshold = 0.012 } = {}) {
    this.config = { minTurnMs, maxTurnMs, silenceMs, rmsThreshold };
    this.reset();
  }

  add(samples) {
    let sum = 0;
    for (const sample of samples) sum += (sample / 32768) ** 2;
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    this.samplesInTurn += samples.length;
    if (rms >= this.config.rmsThreshold) {
      this.heardSpeech = true;
      this.trailingSilentSamples = 0;
    } else {
      this.trailingSilentSamples += samples.length;
    }
    const elapsedMs = this.samplesInTurn / PCM_SAMPLE_RATE * 1000;
    const silentMs = this.trailingSilentSamples / PCM_SAMPLE_RATE * 1000;
    if (!this.heardSpeech && elapsedMs >= this.config.maxTurnMs) {
      this.reset();
      return 'discard';
    }
    if (this.heardSpeech && (elapsedMs >= this.config.maxTurnMs ||
      (elapsedMs >= this.config.minTurnMs && silentMs >= this.config.silenceMs))) {
      this.reset();
      return 'commit';
    }
    return 'continue';
  }

  hasUnconfirmedSpeech() {
    return this.heardSpeech && this.samplesInTurn > 0;
  }

  reset() {
    this.samplesInTurn = 0;
    this.trailingSilentSamples = 0;
    this.heardSpeech = false;
  }
}

function pcmBufferToInt16(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== FRAME_SAMPLES * 2) throw new TypeError('Invalid PCM frame');
  const output = new Int16Array(FRAME_SAMPLES);
  for (let index = 0; index < output.length; index += 1) output[index] = buffer.readInt16LE(index * 2);
  return output;
}

class OpenAIRealtimeAsr {
  constructor({
    apiKey,
    WebSocket,
    model = 'gpt-live-transcribe',
    languages = ['yue', 'en'],
    delay = 'low',
    prompt = '',
    keywords = [],
    openTimeoutMs = 10000,
  }) {
    if (!apiKey || !WebSocket) throw new TypeError('apiKey and WebSocket are required');
    this.options = { apiKey, WebSocket, model, languages, delay, prompt, keywords, openTimeoutMs };
    this.pendingOrders = [];
    this.committedTurns = 0;
    this.terminalTurns = 0;
    this.items = new Map();
    this.pendingProviderEvents = new Map();
    this.closed = false;
  }

  async open(onEvent) {
    if (this.socket) throw new Error('ASR already opened');
    this.onEvent = onEvent;
    const WebSocket = this.options.WebSocket;
    this.socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      maxRedirects: 0,
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('ASR open timed out'), { code: 'asr_timeout' })), this.options.openTimeoutMs);
      const finish = error => {
        clearTimeout(timer);
        this.socket.off?.('open', onOpen);
        this.socket.off?.('error', onError);
        if (error) reject(error); else resolve();
      };
      const onOpen = () => finish();
      const onError = () => finish(Object.assign(new Error('ASR socket failed'), { code: 'asr_connection' }));
      this.socket.once('open', onOpen);
      this.socket.once('error', onError);
    });
    this.socket.on('message', raw => this.handleProviderMessage(String(raw)));
    this.socket.on('error', () => this.onEvent?.({ type: 'failed', code: 'asr_connection' }));
    this.socket.on('close', code => {
      if (!this.closed) this.onEvent?.({ type: 'failed', code: 'asr_connection', closeCode: code });
    });
    const sessionReady = new Promise((resolve, reject) => {
      this.resolveSessionReady = resolve;
      this.rejectSessionReady = reject;
      this.sessionReadyTimer = setTimeout(() => reject(Object.assign(new Error('ASR session update timed out'), { code: 'asr_session_timeout' })),
        this.options.openTimeoutMs);
    });
    const transcription = {
      model: this.options.model,
      languages: this.options.languages,
      delay: this.options.delay,
    };
    if (this.options.prompt) transcription.prompt = this.options.prompt;
    if (this.options.keywords.length) transcription.keywords = this.options.keywords;
    this.send({ type: 'session.update', session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: PCM_SAMPLE_RATE }, transcription, turn_detection: null,
    } } } });
    await sessionReady;
  }

  append(buffer) {
    this.send({ type: 'input_audio_buffer.append', audio: buffer.toString('base64') });
  }

  commit(segmentOrder) {
    this.pendingOrders.push(segmentOrder);
    try { this.send({ type: 'input_audio_buffer.commit' }); this.committedTurns += 1; }
    catch (error) { this.pendingOrders.pop(); throw error; }
  }

  clear() {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  async drain(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (this.terminalTurns < this.committedTurns) {
      if (Date.now() >= deadline) throw Object.assign(new Error('ASR drain timed out'), { code: 'asr_drain_timeout' });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.sessionReadyTimer);
    if (!this.socket) return;
    try { this.socket.close(1000, 'session complete'); } catch { this.socket.terminate?.(); }
  }

  send(payload) {
    const OPEN = this.options.WebSocket.OPEN ?? 1;
    if (!this.socket || this.socket.readyState !== OPEN) throw Object.assign(new Error('ASR is unavailable'), { code: 'asr_unavailable' });
    this.socket.send(JSON.stringify(payload));
  }

  handleProviderMessage(raw) {
    let event;
    try { event = JSON.parse(raw); } catch { return this.fail('asr_invalid_event'); }
    if (!event || typeof event.type !== 'string') return this.fail('asr_invalid_event');
    if (event.type === 'session.updated') {
      clearTimeout(this.sessionReadyTimer);
      this.resolveSessionReady?.();
      this.resolveSessionReady = null;
      this.rejectSessionReady = null;
      return;
    }
    if (event.type === 'input_audio_buffer.committed') {
      if (typeof event.item_id !== 'string' || !this.pendingOrders.length || this.items.has(event.item_id)) return this.fail('asr_untracked_commit');
      const segmentOrder = this.pendingOrders.shift();
      this.items.set(event.item_id, { segmentOrder, text: '', terminal: false });
      this.onEvent?.({ type: 'committed', itemId: event.item_id, segmentOrder });
      for (const queued of this.pendingProviderEvents.get(event.item_id) ?? []) this.applyKnown(queued);
      this.pendingProviderEvents.delete(event.item_id);
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta' ||
      event.type === 'conversation.item.input_audio_transcription.completed' ||
      event.type === 'conversation.item.input_audio_transcription.failed') {
      if (typeof event.item_id !== 'string') return this.fail('asr_invalid_event');
      if (!this.items.has(event.item_id)) {
        const queued = this.pendingProviderEvents.get(event.item_id) ?? [];
        if (queued.length >= 1000) return this.fail('asr_pending_overflow');
        queued.push(event);
        this.pendingProviderEvents.set(event.item_id, queued);
      } else this.applyKnown(event);
      return;
    }
    if (event.type === 'error') this.fail('asr_provider_error');
  }

  applyKnown(event) {
    const item = this.items.get(event.item_id);
    if (!item || item.terminal) return;
    if (event.type.endsWith('.delta')) {
      if (typeof event.delta !== 'string') return this.fail('asr_invalid_event');
      item.text += event.delta;
      this.onEvent?.({ type: 'delta', itemId: event.item_id, text: event.delta, snapshot: item.text, segmentOrder: item.segmentOrder });
    } else if (event.type.endsWith('.completed')) {
      if (typeof event.transcript !== 'string') return this.fail('asr_invalid_event');
      item.terminal = true;
      this.terminalTurns += 1;
      item.text = event.transcript;
      this.onEvent?.({ type: 'completed', itemId: event.item_id, transcript: item.text, segmentOrder: item.segmentOrder });
    } else {
      item.terminal = true;
      this.terminalTurns += 1;
      this.onEvent?.({ type: 'failed', itemId: event.item_id, segmentOrder: item.segmentOrder, code: 'provider_transcription_failed' });
    }
  }

  fail(code) {
    clearTimeout(this.sessionReadyTimer);
    this.rejectSessionReady?.(Object.assign(new Error('ASR session failed'), { code }));
    this.rejectSessionReady = null;
    this.resolveSessionReady = null;
    this.onEvent?.({ type: 'failed', code });
  }
}

module.exports = { TurnBoundaryDetector, pcmBufferToInt16, OpenAIRealtimeAsr };
