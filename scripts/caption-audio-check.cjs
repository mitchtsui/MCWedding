// Offline segmentation comparison. No recognition, network calls or audio writes.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { TurnBoundaryDetector, pcmBufferToInt16 } = require('../lib/captions/asr.cjs');

function readPcmWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected RIFF WAV');
  }
  let format = null, audio = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (length > bytes.length - start) throw new Error('Truncated WAV chunk');
    if (name === 'fmt ') {
      if (length < 16) throw new Error('Invalid WAV format chunk');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        rate: bytes.readUInt32LE(start + 4), align: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    }
    if (name === 'data') {
      if (audio) throw new Error('Multiple WAV data chunks are unsupported');
      audio = bytes.subarray(start, start + length);
    }
    offset = start + length + (length % 2);
  }
  if (!format || !audio || format.encoding !== 1 || format.channels !== 1 || format.rate !== 24000
      || format.bits !== 16 || format.align !== 2 || audio.length % 2) throw new Error('Use actual mono PCM16 at 24 kHz');
  if (!audio.length || audio.length > 24000 * 2 * 15 * 60) throw new Error('Use a recording between 1 sample and 15 minutes');
  return audio;
}

function compare(audio) {
  const frames = Math.floor(audio.length / 2400);
  const profiles = [
    ['fixed-4000ms', { minTurnMs: 300, maxTurnMs: 4000, silenceMs: 4001 }],
    ['pause-450ms', { minTurnMs: 300, maxTurnMs: 6000, silenceMs: 450 }],
    ['pause-600ms', { minTurnMs: 300, maxTurnMs: 6000, silenceMs: 600 }]
  ];
  return {
    kind: 'offline-audio-boundary-check', quality: 'NOT EVALUATED',
    note: 'RMS silence classification is heuristic. Discarded intervals still need listening review; no recognition or latency was measured.',
    pcmSha256: crypto.createHash('sha256').update(audio).digest('hex'), durationSeconds: audio.length / 48000,
    profiles: profiles.map(([name, config]) => {
      const detector = new TurnBoundaryDetector({ ...config, rmsThreshold: 0.012 });
      let first = 0, commits = 0, discarded = 0, committedSamples = 0, discardedSamples = 0, longestMs = 0;
      const intervals = [];
      for (let i = 0; i < frames; i++) {
        const decision = detector.add(pcmBufferToInt16(audio.subarray(i * 2400, (i + 1) * 2400)));
        if (decision === 'continue') continue;
        const end = (i + 1) * 1200, count = end - first;
        intervals.push({ firstSample: first, endSampleExclusive: end, decision });
        if (decision === 'commit') { commits++; committedSamples += count; longestMs = Math.max(longestMs, count / 24); }
        else { discarded++; discardedSamples += count; }
        first = end;
      }
      const pendingSamples = audio.length / 2 - first;
      return { name, commits, discarded, longestCommittedTurnMs: longestMs,
        committedSamples, discardedSamples, pendingSamples,
        accountedSamples: committedSamples + discardedSamples + pendingSamples,
        pendingSpeech: detector.hasUnconfirmedSpeech(), intervals };
    })
  };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Provide one WAV file');
    console.log(JSON.stringify(compare(readPcmWav(fs.readFileSync(process.argv[2]))), null, 2));
  } catch {
    console.error('Offline check failed. Supply a valid mono PCM16/24kHz WAV of at most 15 minutes. No audio was changed or sent.');
    process.exitCode = 1;
  }
}
module.exports = { readPcmWav, compare };
