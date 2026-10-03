'use strict';

const TARGET_LANGUAGES = Object.freeze(['en', 'ja', 'zh-CN']);
const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
const PCM_SAMPLE_RATE = 24_000;
const FRAME_MS = 50;
const FRAME_SAMPLES = PCM_SAMPLE_RATE * FRAME_MS / 1000;
const FRAME_BYTES = FRAME_SAMPLES * 2;

class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value, field, max = 512) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new ProtocolError('invalid_message', `${field} must be a non-empty string`);
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProtocolError('invalid_message', `${field} must be a non-negative integer`);
  }
  return value;
}

function decodeClientMessage(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  if (bytes.length > MAX_CLIENT_MESSAGE_BYTES) {
    throw new ProtocolError('message_too_large', 'Client message exceeds the size limit');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ProtocolError('invalid_json', 'Client message is not valid JSON');
  }
  if (!isPlainObject(value)) throw new ProtocolError('invalid_message', 'Client message must be an object');
  if (value.type === 'auth') {
    return { type: 'auth', ticket: nonEmptyString(value.ticket, 'ticket', 2048) };
  }
  if (value.type === 'audio') {
    const captureEpoch = nonEmptyString(value.captureEpoch, 'captureEpoch', 128);
    const sequence = nonNegativeInteger(value.sequence, 'sequence');
    const sampleOffset = nonNegativeInteger(value.sampleOffset, 'sampleOffset');
    if (typeof value.audio !== 'string' || value.audio.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.audio)) {
      throw new ProtocolError('invalid_audio', 'audio must be base64 PCM16');
    }
    const audio = Buffer.from(value.audio, 'base64');
    if (audio.length !== FRAME_BYTES || audio.toString('base64') !== value.audio) {
      throw new ProtocolError('invalid_audio_frame', `audio must contain exactly ${FRAME_BYTES} PCM16 bytes`);
    }
    return { type: 'audio', captureEpoch, sequence, sampleOffset, audio };
  }
  if (value.type === 'drain' && ['end', 'pause'].includes(value.reason)) return { type: 'drain', reason: value.reason };
  throw new ProtocolError('unsupported_message', 'Unsupported client message type');
}

function validateCaptionUpdate(update) {
  if (!isPlainObject(update)) throw new ProtocolError('invalid_caption', 'Caption update must be an object');
  const language = nonEmptyString(update.language, 'language', 8);
  if (!TARGET_LANGUAGES.includes(language)) throw new ProtocolError('invalid_caption', 'Unsupported language');
  if (!['draft', 'final', 'corrected', 'unavailable'].includes(update.status)) {
    throw new ProtocolError('invalid_caption', 'Unsupported caption status');
  }
  if (typeof update.text !== 'string' || update.text.length > 4000) {
    throw new ProtocolError('invalid_caption', 'Caption text exceeds the configured limit');
  }
  return {
    segmentId: nonEmptyString(update.segmentId, 'segmentId', 128),
    segmentOrder: nonNegativeInteger(update.segmentOrder, 'segmentOrder'),
    sourceRevision: nonNegativeInteger(update.sourceRevision, 'sourceRevision'),
    captionRevision: nonNegativeInteger(update.captionRevision, 'captionRevision'),
    language,
    status: update.status,
    origin: update.origin === 'manual' ? 'manual' : 'ai_live',
    text: update.text,
  };
}

function captionBatch(input) {
  return {
    schemaVersion: 1,
    type: 'caption.batch',
    eventId: nonEmptyString(input.eventId, 'eventId'),
    runId: nonEmptyString(input.runId, 'runId'),
    modeGeneration: nonNegativeInteger(input.modeGeneration, 'modeGeneration'),
    channelEpoch: nonEmptyString(input.channelEpoch, 'channelEpoch'),
    messageSeq: nonNegativeInteger(input.messageSeq, 'messageSeq'),
    language: nonEmptyString(input.language, 'language', 8),
    publishedAt: new Date(input.publishedAt).toISOString(),
    updates: input.updates.map(validateCaptionUpdate),
  };
}

function errorEvent(code, message, retryable = false) {
  return { type: 'error', code, message, retryable: Boolean(retryable) };
}

module.exports = {
  TARGET_LANGUAGES,
  MAX_CLIENT_MESSAGE_BYTES,
  PCM_SAMPLE_RATE,
  FRAME_MS,
  FRAME_SAMPLES,
  FRAME_BYTES,
  ProtocolError,
  decodeClientMessage,
  validateCaptionUpdate,
  captionBatch,
  errorEvent,
};
