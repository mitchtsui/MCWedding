'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSpeech, translateCue, MAX_CUE_UNITS } = require('../lib/captions/prepared-speech.cjs');

test('prepared speech splits Cantonese, English and explicit lines without losing punctuation', () => {
  const input = '各位晚上好！多謝大家。\nThank you for coming. Welcome everyone!';
  assert.deepEqual(splitSpeech(input), ['各位晚上好！', '多謝大家。', 'Thank you for coming.', 'Welcome everyone!']);
});

test('long caption blocks preserve text and whole emoji within the display bound', () => {
  const input = '甲'.repeat(199) + '😀' + '乙'.repeat(205) + '。';
  const cues = splitSpeech(input);
  assert.equal(cues.join(''), input);
  assert.ok(cues.every(cue => cue.length <= MAX_CUE_UNITS && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(cue)));
  const words = ('hello '.repeat(100)).trim();
  assert.equal(splitSpeech(words).join(' '), words);
});

test('preparation rejects empty, oversized, and too-many-block speeches', () => {
  for (const input of ['', '   ', null, '甲'.repeat(12001), '甲。'.repeat(121)]) {
    assert.throws(() => splitSpeech(input), { code: 'INVALID_REQUEST' });
  }
  assert.equal(splitSpeech('甲'.repeat(12000)).length, 60);
});

test('one prepared block translates exactly three locales with bounded prior context', async () => {
  const calls = [];
  const result = await translateCue({ source: '多謝大家。', prior: ['a','b','c','d'], glossary: ['Synthetic name'],
    translator: { async translate(input) { calls.push(input); return { text: ' ' + input.language + ' text ' }; } } });
  assert.deepEqual(result.translations, { en: 'en text', ja: 'ja text', 'zh-CN': 'zh-CN text' });
  assert.deepEqual(result.usageByLanguage, { en: null, ja: null, 'zh-CN': null });
  assert.deepEqual(calls.map(call => call.language), ['en','ja','zh-CN']);
  assert.ok(calls.every(call => call.context.join(',') === 'b,c,d' && call.currentSegment === '多謝大家。'));
});

test('failed or incomplete translations never return a partial prepared block or leak provider text', async () => {
  let sharedSignal;
  await assert.rejects(translateCue({ source: 'Synthetic source', translator: {
    async translate({ language, signal }) { sharedSignal = signal; if (language === 'ja') throw new Error('private provider payload'); return { text: 'Valid' }; }
  } }), error => error.code === 'PREPARATION_FAILED' && !error.message.includes('private'));
  assert.equal(sharedSignal.aborted, true);
  for (const text of ['', 'x'.repeat(2001)]) {
    await assert.rejects(translateCue({ source: 'Synthetic', translator: { async translate() { return { text }; } } }), { code: 'PREPARATION_FAILED' });
  }
});

test('already cancelled preparation makes no provider request', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(translateCue({ source: 'Synthetic', signal: controller.signal,
    translator: { async translate() { calls += 1; return { text: 'text' }; } } }), { code: 'PREPARATION_CANCELLED' });
  assert.equal(calls, 0);
});
