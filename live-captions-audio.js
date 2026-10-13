(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CaptionsAudio = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  class Capture {
    constructor(options) {
      this.options = options || {}; this.stream = null; this.preparedStream = null; this.context = null; this.node = null; this.source = null; this.kind = '';
      this.generation = 0;
    }
    media() { return this.options.mediaDevices || navigator.mediaDevices; }
    tracks(stream) { return stream?.getTracks?.() || []; }
    stopStream(stream) { this.tracks(stream).forEach(track => track.stop()); }
    liveAudio(stream) { return (stream?.getAudioTracks?.() || []).find(track => track.readyState !== 'ended'); }
    async devices() {
      const media = this.media();
      if (!media?.enumerateDevices) return [];
      return (await media.enumerateDevices()).filter(device => device.kind === 'audioinput')
        .map(device => ({ id: device.deviceId, label: device.label || 'Microphone' }));
    }
    // Browsers hide device ids and names until the page has microphone permission. This asks for it and
    // releases the stream at once; capture itself still opens only the device the operator chose.
    async permit() {
      const media = this.media();
      if (!media?.getUserMedia) throw new Error('Microphone capture is unavailable');
      const stream = await media.getUserMedia({ audio: true, video: false });
      this.stopStream(stream);
    }

    // This method deliberately calls getDisplayMedia before its first await. Call it directly from a
    // click handler: browsers reject a screen/system-audio picker that is opened after async work.
    async prepareDisplay() {
      const media = this.media();
      if (!media?.getDisplayMedia) throw new Error('PC audio sharing is unavailable in this browser');
      const old = this.preparedStream; this.preparedStream = null; this.stopStream(old);
      const generation = ++this.generation;
      const pending = media.getDisplayMedia({ video: true, audio: true, systemAudio: 'include', surfaceSwitching: 'exclude', selfBrowserSurface: 'exclude' });
      let stream;
      try { stream = await pending; }
      catch (error) { if (generation === this.generation) this.preparedStream = null; throw error; }
      if (generation !== this.generation) { this.stopStream(stream); throw new Error('PC audio sharing was cancelled'); }
      if (!this.liveAudio(stream)) { this.stopStream(stream); throw new Error('The selected share has no audio. Choose a browser tab and enable Share tab audio, or choose an entire screen with system audio when offered.'); }
      this.preparedStream = stream;
      this.watchEnded(stream, generation, false);
      this.options.onPrepared?.('pc');
      return stream;
    }
    hasPreparedDisplay() { return Boolean(this.preparedStream && this.liveAudio(this.preparedStream)); }
    discardPrepared() {
      const stream = this.preparedStream; this.preparedStream = null; this.generation += 1; this.stopStream(stream);
      this.options.onPrepared?.('');
    }
    watchEnded(stream, generation, active) {
      const ended = () => {
        if (generation !== this.generation) return;
        if (active && this.stream !== stream) return;
        if (!active && this.preparedStream !== stream) return;
        if (!active) { this.preparedStream = null; this.generation += 1; this.stopStream(stream); }
        this.options.onDeviceEnded?.({ source: this.kind || 'pc', active });
        if (active) void this.stop();
      };
      this.tracks(stream).forEach(track => track.addEventListener?.('ended', ended, { once: true }));
    }
    async start(kind, deviceId) {
      kind = kind || 'microphone';
      // Keep the original start(deviceId) form for existing microphone callers.
      if (kind !== 'microphone' && kind !== 'pc') { deviceId = kind; kind = 'microphone'; }
      if (kind === 'microphone' && !deviceId) throw new Error('Select a microphone first');
      if (kind === 'pc' && !this.hasPreparedDisplay()) throw new Error('Share PC audio before starting captions');
      const prepared = kind === 'pc' ? this.preparedStream : null;
      if (kind === 'microphone') this.stopStream(this.preparedStream);
      this.preparedStream = null;
      // stop() invalidates prior work synchronously. Remember that token before waiting for its context to close,
      // so a concurrent Stop cannot be followed by a late capture start.
      const stopping = this.stop(false), generation = this.generation;
      await stopping;
      const cancelledMessage = kind === 'pc' ? 'PC audio start was cancelled' : 'Microphone start was cancelled';
      if (generation !== this.generation) { this.stopStream(prepared); throw new Error(cancelledMessage); }
      const media = this.media();
      const AudioContextClass = this.options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass || (kind === 'microphone' && !media?.getUserMedia)) { this.stopStream(prepared); throw new Error(kind === 'pc' ? 'PC audio capture is unavailable' : 'Microphone capture is unavailable'); }
      let stream = prepared, context = null;
      try {
        stream ||= await media.getUserMedia({ audio: { deviceId: { exact: deviceId }, channelCount: 1,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        if (generation !== this.generation) throw new Error(cancelledMessage);
        const track = this.liveAudio(stream);
        if (!track) throw new Error(kind === 'pc' ? 'The shared PC audio is no longer available' : 'Selected microphone is unavailable');
        this.stream = stream; this.kind = kind;
        this.watchEnded(stream, generation, true);
        context = new AudioContextClass({ latencyHint: 'interactive' }); this.context = context;
        await context.audioWorklet.addModule(this.options.workletUrl || 'live-captions-worklet.js');
        if (generation !== this.generation) throw new Error(cancelledMessage);
        if (context.state === 'suspended') await context.resume();
        if (generation !== this.generation) throw new Error(cancelledMessage);
        const node = new AudioWorkletNode(context, 'caption-pcm-processor');
        node.port.onmessage = event => {
          if (generation !== this.generation || this.node !== node) return;
          if (event.data?.type === 'frame') this.options.onFrame?.(event.data.audio, event.data.samples);
          else if (event.data?.type === 'meter') this.options.onMeter?.(event.data.rms);
        };
        const source = context.createMediaStreamSource(stream), silence = context.createGain();
        silence.gain.value = 0; source.connect(node); node.connect(silence); silence.connect(context.destination);
        this.node = node; this.source = source;
        this.options.onState?.('capturing');
      } catch (error) {
        if (generation === this.generation) this.generation += 1;
        if (this.stream === stream) this.stream = null;
        if (this.context === context) this.context = null;
        this.node = null; this.source = null;
        this.kind = ''; this.stopStream(stream); await Promise.resolve(context?.close?.()).catch(() => {}); throw error;
      }
    }
    async stop(includePrepared = true) {
      this.generation += 1;
      const stream = this.stream, prepared = includePrepared ? this.preparedStream : null, context = this.context, node = this.node;
      this.stream = null; if (includePrepared) this.preparedStream = null; this.context = null; this.node = null; this.source = null; this.kind = '';
      try { node?.port.postMessage({ type: 'reset' }); node?.disconnect(); } catch {}
      this.stopStream(stream); this.stopStream(prepared);
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      if (includePrepared && prepared) this.options.onPrepared?.('');
      this.options.onMeter?.(0); this.options.onState?.('stopped');
    }
    active() { return Boolean(this.stream && this.context); }
  }
  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }
  return Object.freeze({ Capture, bytesToBase64 });
}));
