class CaptionPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.input = []; this.position = 0; this.frame = []; this.ratio = sampleRate / 24000;
    this.port.onmessage = event => { if (event.data?.type === 'reset') this.reset(); };
  }
  reset() { this.input = []; this.position = 0; this.frame = []; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let index = 0; index < channels[0].length; index += 1) {
      let value = 0;
      for (const channel of channels) value += channel[index] || 0;
      this.input.push(value / channels.length);
    }
    while (this.position + 1 < this.input.length) {
      const left = Math.floor(this.position), fraction = this.position - left;
      const value = this.input[left] * (1 - fraction) + this.input[left + 1] * fraction;
      this.frame.push(Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, value)) * 32767))));
      this.position += this.ratio;
      if (this.frame.length === 1200) this.emitFrame();
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) { this.input.splice(0, consumed); this.position -= consumed; }
    return true;
  }
  emitFrame() {
    const pcm = Int16Array.from(this.frame); let energy = 0;
    for (const value of pcm) energy += (value / 32768) ** 2;
    const rms = Math.sqrt(energy / pcm.length); this.frame = [];
    this.port.postMessage({ type: 'frame', audio: pcm.buffer, samples: pcm.length }, [pcm.buffer]);
    this.port.postMessage({ type: 'meter', rms });
  }
}
registerProcessor('caption-pcm-processor', CaptionPcmProcessor);
