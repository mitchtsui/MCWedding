'use strict';

const LANGUAGES = Object.freeze(['en', 'ja', 'zh-CN']);
const MAX_SOURCE_UNITS = 12000;
const MAX_CUE_UNITS = 200;
const MAX_CUES = 120;
const MAX_TRANSLATION_UNITS = 2000;

class PreparedSpeechError extends Error {
  constructor(code, message) { super(message); this.name = 'PreparedSpeechError'; this.code = code; }
}

// Keep punctuation with the words it belongs to. Long sentences prefer a clause
// or word boundary; an unbroken string is split without cutting a surrogate pair.
function boundSentence(sentence) {
  const chunks = [];
  let rest = sentence.trim();
  while (rest.length > MAX_CUE_UNITS) {
    let end = MAX_CUE_UNITS;
    if (/^[\uDC00-\uDFFF]$/.test(rest[end])) end -= 1;
    const prefix = rest.slice(0, end);
    const boundaries = [...prefix.matchAll(/[,，、;；:：]\s*|\s+/gu)];
    const last = boundaries.at(-1);
    if (last && last.index + last[0].length >= Math.floor(MAX_CUE_UNITS / 2)) end = last.index + last[0].length;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function splitSpeech(content) {
  if (typeof content !== 'string' || !content.trim() || content.length > MAX_SOURCE_UNITS) {
    throw new PreparedSpeechError('INVALID_REQUEST', 'Enter a speech of 1–12,000 characters.');
  }
  const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'sentence' });
  const cues = content.split(/\r?\n+/u).flatMap(paragraph =>
    [...segmenter.segment(paragraph)].flatMap(part => boundSentence(part.segment)));
  if (cues.length > MAX_CUES) {
    throw new PreparedSpeechError('INVALID_REQUEST', 'This speech has more than 120 caption blocks. Save it as smaller speech sections.');
  }
  return cues;
}

async function translateCue({ translator, source, prior = [], glossary = [], signal }) {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_CUE_UNITS) {
    throw new PreparedSpeechError('INVALID_REQUEST', 'Caption blocks must contain 1–200 characters.');
  }
  if (!translator || typeof translator.translate !== 'function') throw new TypeError('translator is required');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    if (controller.signal.aborted) throw new PreparedSpeechError('PREPARATION_CANCELLED', 'Translation preparation was cancelled.');
    const entries = await Promise.all(LANGUAGES.map(async language => {
      const result = await translator.translate({ language, currentSegment: source,
        context: prior.slice(-3), glossary, signal: controller.signal });
      if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > MAX_TRANSLATION_UNITS) {
        throw new PreparedSpeechError('PREPARATION_FAILED', 'A caption translation was empty or too long. Retry this block.');
      }
      return { language, text: result.text.trim(), usage: result.usage ?? null };
    }));
    if (controller.signal.aborted) throw new PreparedSpeechError('PREPARATION_CANCELLED', 'Translation preparation was cancelled.');
    return { translations: Object.fromEntries(entries.map(item => [item.language, item.text])),
      usageByLanguage: Object.fromEntries(entries.map(item => [item.language, item.usage])) };
  } catch (error) {
    controller.abort();
    if (error instanceof PreparedSpeechError) throw error;
    // Provider failures can contain submitted text; only a fixed error reaches callers.
    throw new PreparedSpeechError('PREPARATION_FAILED', 'Translation preparation failed. No partial translation was saved; retry this block.');
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

module.exports = { splitSpeech, translateCue, PreparedSpeechError, LANGUAGES,
  MAX_SOURCE_UNITS, MAX_CUE_UNITS, MAX_CUES, MAX_TRANSLATION_UNITS };
