import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LANGUAGES = ['en', 'ja', 'zh-CN'];
const METHODS = ['same-clock', 'calibrated-cross-device', 'direct-recording'];

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function finite(value, name, min = 0) {
  if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${name}`);
}

/** Human-reviewed timings only. Never infer correctness from API first-token time. */
export function evaluate(input) {
  if (!input || !['mock', 'live'].includes(input.mode)) throw new Error('Explicit mode required');
  if (!METHODS.includes(input.measurementMethod)) throw new Error('Measurement method required');
  finite(input.clockErrorMs, 'clockErrorMs');
  if (!Array.isArray(input.segments) || !input.segments.length) throw new Error('Segments required');
  const seen = new Set();
  let priorEnd = -1;
  for (const segment of input.segments) {
    if (typeof segment.id !== 'string' || !segment.id || seen.has(segment.id)) {
      throw new Error('Unique nonempty segment IDs required');
    }
    seen.add(segment.id);
    finite(segment.phraseEndMs, 'phraseEndMs');
    if (segment.phraseEndMs < priorEnd) throw new Error('Segments must follow capture order');
    priorEnd = segment.phraseEndMs;
    for (const language of LANGUAGES) {
      const r = segment.reviews?.[language];
      if (!r || !['correct', 'incorrect', 'missing', 'unreviewed'].includes(r.verdict)) {
        throw new Error('Each phrase needs explicit review status for all three languages');
      }
      if (typeof r.criticalError !== 'boolean') throw new Error('Explicit criticalError required');
      if (!Number.isInteger(r.revisions) || r.revisions < 0) throw new Error('Invalid revisions');
      for (const field of ['firstCorrectMs', 'finalMs']) {
        if (r[field] !== null) finite(r[field], field, segment.phraseEndMs);
      }
      if (r.verdict === 'correct' && r.firstCorrectMs === null) throw new Error('Correct timing required');
      if (r.verdict !== 'correct' && r.firstCorrectMs !== null) throw new Error('Noncorrect phrase has correct timing');
      if (r.verdict === 'correct' && r.criticalError) throw new Error('Critical error cannot be correct');
      if (r.verdict === 'missing' && r.finalMs !== null) throw new Error('Missing phrase has final timing');
      if (r.firstCorrectMs !== null && r.finalMs !== null && r.finalMs < r.firstCorrectMs) {
        throw new Error('Final cannot precede first correct rendering');
      }
    }
  }
  return {
    mode: input.mode,
    measurementMethod: input.measurementMethod,
    clockErrorMs: input.clockErrorMs,
    percentileMethod: 'nearest-rank; correct-rendered samples only; failures separately counted',
    productionAcceptance: 'NOT EVALUATED: account, security, device, capacity, soak and venue gates are separate',
    languages: Object.fromEntries(LANGUAGES.map(language => {
      const rows = input.segments.map(s => ({ end: s.phraseEndMs, ...s.reviews[language] }));
      const correct = rows.filter(r => r.verdict === 'correct');
      const first = correct.map(r => r.firstCorrectMs - r.end);
      const finals = correct.filter(r => r.finalMs !== null).map(r => r.finalMs - r.end);
      const unreviewed = rows.filter(r => r.verdict === 'unreviewed').length;
      const missing = rows.filter(r => r.verdict === 'missing').length;
      const criticalErrors = rows.filter(r => r.criticalError).length;
      const p50 = percentile(first, 0.5), p95 = percentile(first, 0.95);
      const finalP95 = percentile(finals, 0.95);
      const quality = correct.length / rows.length;
      const eligible = input.mode === 'live' && rows.length >= 100 && unreviewed === 0;
      const completedCorrect = finals.length === correct.length;
      const latencyPass = p50 !== null && p95 !== null && finalP95 !== null &&
        p50 + input.clockErrorMs <= 4000 && p95 + input.clockErrorMs <= 6000 &&
        finalP95 + input.clockErrorMs <= 9000 && completedCorrect;
      return [language, {
        samples: rows.length, correct: correct.length, missing, unreviewed,
        incorrect: rows.filter(r => r.verdict === 'incorrect').length,
        unfinished: rows.filter(r => r.finalMs === null).length,
        criticalErrors, correctFraction: quality,
        revisedFraction: rows.filter(r => r.revisions > 0).length / rows.length,
        latencySamples: first.length, finalLatencySamples: finals.length,
        firstCorrectP50Ms: p50, firstCorrectP95Ms: p95, finalP95Ms: finalP95,
        preliminaryLanguageGate: !eligible ? 'NOT EVALUATED' :
          quality >= 0.9 && criticalErrors === 0 && latencyPass ? 'PASS' : 'FAIL',
      }];
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/evaluate.mjs private/review.json');
    const report = evaluate(JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '')));
    console.log(JSON.stringify(report, null, 2));
  } catch {
    // Do not echo malformed input, file paths, transcript text or native exception data.
    console.error('Evaluation failed: check review schema in docs/EVALUATION.md and input path.');
    process.exitCode = 1;
  }
}
