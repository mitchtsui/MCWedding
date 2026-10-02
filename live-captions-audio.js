(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CaptionsAudio = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  class Capture {
    constructor(options) {
      this.options = options || {}; this.stream = null; this.context = null; this.node = null; this.source = null;
      this.generation = 0;
    }
    async devices() {
      const media = this.options.mediaDevices || navigator.mediaDevices;
      if (!media?.enumerateDevices) return [];
      return (await media.enumerateDevices()).filter(device => device.kind === 'audioinput')
        .map(device => ({ id: device.deviceId, label: device.label || 'Microphone' }));
    }
    // Browsers hide device ids and names until the page has microphone permission. This asks for it and
    // releases the stream at once; capture itself still opens only the device the operator chose.
    async permit() {
      const media = this.options.mediaDevices || navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error('Microphone capture is unavailable');
      const stream = await media.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
    }
    async start(deviceId) {
      if (!deviceId) throw new Error('Select a microphone first');
      await this.stop();
      const generation = ++this.generation;
      const media = this.options.mediaDevices || navigator.mediaDevices;
      const AudioContextClass = this.options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!media?.getUserMedia || !AudioContextClass) throw new Error('Microphone capture is unavailable');
      const stream = await media.getUserMedia({ audio: { deviceId: { exact: deviceId }, channelCount: 1,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(item => item.stop()); throw new Error('Microphone start was cancelled'); }
      const track = stream.getAudioTracks()[0];
      if (!track) { stream.getTracks().forEach(item => item.stop()); throw new Error('Selected microphone is unavailable'); }
      this.stream = stream;
      track.addEventListener('ended', () => { if (generation !== this.generation) return; this.options.onDeviceEnded?.(); void this.stop(); }, { once: true });
      const context = new AudioContextClass({ latencyHint: 'interactive' });
      this.context = context;
      try {
        await context.audioWorklet.addModule(this.options.workletUrl || 'live-captions-worklet.js');
        if (generation !== this.generation) throw new Error('Microphone start was cancelled');
        if (context.state === 'suspended') await context.resume();
        if (generation !== this.generation) throw new Error('Microphone start was cancelled');
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
        stream.getTracks().forEach(item => item.stop()); await context.close().catch(() => {}); throw error;
      }
    }
    async stop() {
      this.generation += 1;
      const stream = this.stream, context = this.context, node = this.node;
      this.stream = null; this.context = null; this.node = null; this.source = null;
      try { node?.port.postMessage({ type: 'reset' }); node?.disconnect(); } catch {}
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') await context.close().catch(() => {});
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
