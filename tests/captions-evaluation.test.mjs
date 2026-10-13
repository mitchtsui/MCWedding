import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, percentile } from '../scripts/evaluate.mjs';

function fixture(count = 1, mode = 'mock') {
  return { mode, measurementMethod: 'same-clock', clockErrorMs: 0,
    segments: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, phraseEndMs: i * 4000,
      reviews: Object.fromEntries(['en', 'ja', 'zh-CN'].map(l => [l, {
        verdict: 'correct', firstCorrectMs: i * 4000 + 3000, finalMs: i * 4000 + 5000,
        criticalError: false, revisions: 0,
      }])) })) };
}

test('nearest-rank small samples and empty samples are explicit', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([9000, 1000, 3000], 0.95), 9000);
});
test('mock and small samples cannot pass the language gate', () => {
  assert.equal(evaluate(fixture(100)).languages.en.preliminaryLanguageGate, 'NOT EVALUATED');
  assert.equal(evaluate(fixture(1, 'live')).languages.en.preliminaryLanguageGate, 'NOT EVALUATED');
});
test('slow sentences remain in percentiles', () => {
  const data = fixture(100, 'live');
  for (const s of data.segments.slice(90)) {
    s.reviews.en.firstCorrectMs = s.phraseEndMs + 12000;
    s.reviews.en.finalMs = s.phraseEndMs + 14000;
  }
  const result = evaluate(data);
  assert.equal(result.languages.en.firstCorrectP95Ms, 12000);
  assert.equal(result.languages.en.preliminaryLanguageGate, 'FAIL');
  assert.equal(result.languages.ja.preliminaryLanguageGate, 'PASS');
});
test('missing and unfinished stay in the denominator; critical errors fail', () => {
  const data = fixture(100, 'live');
  Object.assign(data.segments[0].reviews.en, { verdict: 'missing', firstCorrectMs: null, finalMs: null });
  Object.assign(data.segments[1].reviews.en, { verdict: 'incorrect', firstCorrectMs: null, criticalError: true });
  const r = evaluate(data).languages.en;
  assert.equal(r.correctFraction, 0.98);
  assert.equal(r.missing, 1);
  assert.equal(r.unfinished, 1);
  assert.equal(r.preliminaryLanguageGate, 'FAIL');
});
test('rejects missing language, duplicate IDs and cross-clock negative times', () => {
  const data = fixture(2);
  delete data.segments[0].reviews.ja;
  assert.throws(() => evaluate(data));
  const duplicate = fixture(2);
  duplicate.segments[1].id = 's0';
  assert.throws(() => evaluate(duplicate));
  const backwards = fixture(2);
  backwards.segments[1].reviews.en.firstCorrectMs = 0;
  assert.throws(() => evaluate(backwards));
});
test('clock uncertainty is included in threshold and unreviewed blocks gate', () => {
  const data = fixture(100, 'live');
  data.clockErrorMs = 1500;
  assert.equal(evaluate(data).languages.en.preliminaryLanguageGate, 'FAIL');
  Object.assign(data.segments[0].reviews.en, { verdict: 'unreviewed', firstCorrectMs: null });
  assert.equal(evaluate(data).languages.en.preliminaryLanguageGate, 'NOT EVALUATED');
});
