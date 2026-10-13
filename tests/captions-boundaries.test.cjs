const test = require('node:test');
const assert = require('node:assert/strict');
const { readPcmWav, compare } = require('../scripts/caption-audio-check.cjs');

test('offline comparison accounts for every sample including partial frames and pending tail', () => {
  const pcm = Buffer.alloc(48000 * 13 + 246);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(5000, i * 2);
  const result = compare(pcm);
  assert.equal(result.quality, 'NOT EVALUATED');
  for (const profile of result.profiles) {
    assert.equal(profile.accountedSamples, pcm.length / 2);
    assert.ok(profile.longestCommittedTurnMs <= (profile.name.startsWith('fixed') ? 4000 : 6000));
    assert.ok(profile.pendingSamples > 0);
  }
});

test('silence stays explicitly counted rather than masquerading as recognized speech', () => {
  for (const profile of compare(Buffer.alloc(48000 * 12)).profiles) {
    assert.equal(profile.commits, 0);
    assert.ok(profile.discardedSamples > 0);
    assert.equal(profile.accountedSamples, 24000 * 12);
  }
});

test('WAV format labels cannot bypass physical sample format checks', () => {
  const wav = Buffer.alloc(46);
  wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  assert.equal(readPcmWav(wav).length, 2);
  wav.writeUInt32LE(48000, 24); assert.throws(() => readPcmWav(wav), /24 kHz/);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(200, 40); assert.throws(() => readPcmWav(wav), /Truncated/);
});
