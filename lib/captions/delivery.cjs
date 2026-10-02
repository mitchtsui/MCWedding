'use strict';

const { CaptionStoreError } = require('./store.cjs');

function safeUpdate(update) {
  return {
    segmentId: update?.segmentId,
    segmentOrder: update?.segmentOrder,
    sourceRevision: update?.sourceRevision,
    captionRevision: update?.captionRevision,
    status: update?.status,
    origin: update?.origin,
    text: update?.text,
    language: update?.language
  };
}

function guestPayload(payload) {
  if (!payload || payload.type !== 'caption.batch' || !payload.eventId || !payload.runId || !payload.language) {
    throw new CaptionStoreError('INVALID_OUTBOX', 'Caption delivery payload is invalid', 500);
  }
  return {
    schemaVersion: payload.schemaVersion || 1,
    type: 'caption.batch',
    eventId: payload.eventId,
    runId: payload.runId,
    modeGeneration: payload.modeGeneration,
    channelEpoch: payload.channelEpoch,
    messageSeq: payload.messageSeq,
    language: payload.language,
    ...(payload.status ? { status: payload.status } : {}),
    updates: Array.isArray(payload.updates) ? payload.updates.map(safeUpdate) : []
  };
}

class CaptionDelivery {
  constructor({ supabaseUrl, serviceRoleKey, fetchImpl = global.fetch, timeoutMs = 3000 } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    this.serviceRoleKey = String(serviceRoleKey || '').trim();
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    if (!this.supabaseUrl || !this.serviceRoleKey || typeof this.fetch !== 'function') {
      throw new CaptionStoreError('CAPTIONS_DISABLED', 'Caption delivery is not configured', 503);
    }
  }

  async deliver(row) {
    const payload = guestPayload(row.payload);
    const topic = `caption:${payload.eventId}:${payload.language}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetch(`${this.supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/caption.batch?private=true`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch {
      return { outboxId: row.id, delivered: false, errorCode: 'REALTIME_UNAVAILABLE' };
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return { outboxId: row.id, delivered: false, errorCode: `REALTIME_HTTP_${response.status}` };
    return { outboxId: row.id, delivered: true, errorCode: null };
  }

  async deliverMany(rows) {
    const bounded = Array.isArray(rows) ? rows.slice(0, 6) : [];
    const first = await Promise.all(bounded.map(row => this.deliver(row)));
    const retryById = new Map();
    await Promise.all(first.filter(result => !result.delivered).map(async result => {
      const row = bounded.find(candidate => candidate.id === result.outboxId);
      retryById.set(result.outboxId, await this.deliver(row));
    }));
    return first.map(result => retryById.get(result.outboxId) || result);
  }
}

module.exports = { CaptionDelivery, guestPayload };
