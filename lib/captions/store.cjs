'use strict';

class CaptionStoreError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message);
    this.name = 'CaptionStoreError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function camelKey(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function camelise(value) {
  if (Array.isArray(value)) return value.map(camelise);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [camelKey(key), camelise(item)]));
}

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new CaptionStoreError('INVALID_REQUEST', `${name} is required`, 400);
  }
  return value;
}

class CaptionStore {
  constructor({ supabaseUrl, serviceRoleKey, fetchImpl = global.fetch, requestTimeoutMs = 10000 } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    this.serviceRoleKey = String(serviceRoleKey || '').trim();
    this.fetch = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    if (!this.supabaseUrl || !this.serviceRoleKey || typeof this.fetch !== 'function') {
      throw new CaptionStoreError('CAPTIONS_DISABLED', 'Caption storage is not configured', 503);
    }
  }

  async _request(path, { token = this.serviceRoleKey, method = 'POST', body } = {}) {
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref?.();
    try {
      response = await this.fetch(`${this.supabaseUrl}${path}`, {
        method,
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
        , signal: controller.signal
      });
    } catch (error) {
      throw new CaptionStoreError('SUPABASE_UNAVAILABLE', 'Caption storage is unavailable', 503, error?.message);
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const postgresCode = payload?.code;
      const status = response.status === 401 || response.status === 403 ? response.status
        : postgresCode === '40001' || postgresCode === '23505' ? 409
          : postgresCode === 'P0002' ? 404 : response.status >= 500 ? 503 : 400;
      const code = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN'
        : status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : status === 503 ? 'SUPABASE_UNAVAILABLE' : 'INVALID_REQUEST';
      throw new CaptionStoreError(code, code === 'SUPABASE_UNAVAILABLE' ? 'Caption storage is unavailable' : 'Caption request was rejected', status, postgresCode);
    }
    return camelise(payload);
  }

  rpc(name, args = {}) {
    return this._request(`/rest/v1/rpc/${encodeURIComponent(name)}`, { body: args });
  }

  rpcAsUser(name, args, accessToken) {
    required(accessToken, 'accessToken');
    return this._request(`/rest/v1/rpc/${encodeURIComponent(name)}`, { token: accessToken, body: args });
  }

  async verifyUser(accessToken) {
    required(accessToken, 'accessToken');
    const user = await this._request('/auth/v1/user', { token: accessToken, method: 'GET' });
    if (!user?.id) throw new CaptionStoreError('UNAUTHENTICATED', 'Authentication is required', 401);
    return user;
  }

  async verifyAdmin(accessToken) {
    const user = await this.verifyUser(accessToken);
    const allowed = await this.rpcAsUser('is_admin', {}, accessToken);
    if (allowed !== true) throw new CaptionStoreError('FORBIDDEN', 'Operator access is required', 403);
    return user;
  }

  createEvent({ title, settings = {} }) {
    return this.rpc('caption_create_event', { p_title: required(title, 'title'), p_settings: settings });
  }

  startRun({ eventId, mode = 'live' }) {
    return this.rpc('caption_start_run', { p_event_id: required(eventId, 'eventId'), p_mode: mode });
  }

  async getEventCurrentRun({ eventId }) {
    // The id goes into a PostgREST filter, so only a plain UUID may reach the URL.
    if (typeof eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      throw new CaptionStoreError('INVALID_REQUEST', 'eventId is invalid', 400);
    }
    const rows = await this._request(`/rest/v1/caption_events?id=eq.${eventId}&select=current_run_id`, { method: 'GET' });
    return Array.isArray(rows) ? rows[0]?.currentRunId ?? null : null;
  }

  transitionRun({ runId, action }) {
    return this.rpc('caption_transition_run', { p_run_id: required(runId, 'runId'), p_action: required(action, 'action') });
  }

  createInvite({ eventId, expiresAt, maxUses = 60 }) {
    return this.rpc('caption_create_invite', { p_event_id: required(eventId, 'eventId'), p_expires_at: required(expiresAt, 'expiresAt'), p_max_uses: maxUses });
  }

  redeemInvite({ eventId, token, accessToken }) {
    return this.rpcAsUser('caption_redeem_invite', { p_event_id: required(eventId, 'eventId'), p_token: required(token, 'token') }, accessToken);
  }

  issueUplinkTicket({ runId, origin, accessToken }) {
    return this.rpcAsUser('caption_issue_uplink_ticket', { p_run_id: required(runId, 'runId'), p_origin: required(origin, 'origin') }, accessToken);
  }

  consumeUplinkTicket({ token, origin }) {
    return this.rpc('caption_consume_uplink_ticket', { p_token: required(token, 'token'), p_origin: required(origin, 'origin') });
  }

  getRunState({ runId }) {
    return this.rpc('caption_run_state', { p_run_id: required(runId, 'runId') });
  }

  getRuntimeContext({ runId, modeGeneration, fencingToken }) {
    return this.rpc('caption_runtime_context', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken
    });
  }

  renewPublisherLease({ runId, modeGeneration, fencingToken }) {
    return this.rpc('caption_renew_publisher_lease', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken
    });
  }

  reserveSegmentOrder({ runId, modeGeneration, fencingToken }) {
    return this.rpc('caption_reserve_segment_order', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken
    });
  }

  reserveMessageSequenceBlock({ runId, modeGeneration, fencingToken, size = 128 }) {
    return this.rpc('caption_reserve_message_sequence_block', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration,
      p_fencing_token: fencingToken, p_size: size
    });
  }

  checkpointSource({ runId, modeGeneration, fencingToken, sourceSegment }) {
    return this.rpc('caption_checkpoint_source', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken,
      p_source_segment: required(sourceSegment, 'sourceSegment')
    });
  }

  getSnapshot({ eventId, runId, language, accessToken }) {
    return this.rpcAsUser('caption_snapshot', {
      p_event_id: required(eventId, 'eventId'), p_run_id: required(runId, 'runId'), p_language: required(language, 'language')
    }, accessToken);
  }

  checkpointDraft({ runId, modeGeneration, fencingToken, segment, captions }) {
    return this.rpc('caption_checkpoint_draft', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken,
      p_segment: required(segment, 'segment'), p_captions: captions || []
    });
  }

  persistFinalAndEnqueue({ runId, modeGeneration, fencingToken, sourceSegment, captions, payloads, idempotencyKey }) {
    return this.rpc('caption_persist_final_and_enqueue', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken,
      p_source_segment: required(sourceSegment, 'sourceSegment'), p_captions: captions || [], p_payloads: payloads || [],
      p_idempotency_key: required(idempotencyKey, 'idempotencyKey')
    });
  }

  claimOutbox({ runId, limit = 20, workerId, modeGeneration, fencingToken }) {
    return this.rpc('caption_claim_outbox', {
      p_run_id: required(runId, 'runId'), p_limit: limit, p_worker_id: required(workerId, 'workerId'),
      p_mode_generation: modeGeneration, p_fencing_token: fencingToken
    });
  }

  completeOutbox({ outboxId, workerId, error = null }) {
    return this.rpc('caption_complete_outbox', { p_outbox_id: required(outboxId, 'outboxId'), p_worker_id: required(workerId, 'workerId'), p_error_code: error?.code || null });
  }

  claimHttpOutbox({ outboxIds, workerId }) {
    return this.rpc('caption_claim_http_outbox', {
      p_outbox_ids: Array.isArray(outboxIds) ? outboxIds : [], p_worker_id: required(workerId, 'workerId')
    });
  }

  validateHttpOutbox({ outboxId, workerId }) {
    return this.rpc('caption_validate_http_outbox', {
      p_outbox_id: required(outboxId, 'outboxId'), p_worker_id: required(workerId, 'workerId')
    });
  }

  recordOperationalEvent({ runId, type, detailsSafe = {} }) {
    return this.rpc('caption_record_operational_event', { p_run_id: required(runId, 'runId'), p_type: required(type, 'type'), p_details_safe: detailsSafe });
  }

  recoverPending({ runId, limit = 100 }) {
    return this.rpc('caption_recover_pending', { p_run_id: required(runId, 'runId'), p_limit: limit });
  }

  publishManual({ runId, language, text, segmentId = null }) {
    return this.rpc('caption_manual_publish', { p_run_id: required(runId, 'runId'), p_language: required(language, 'language'), p_text: required(text, 'text'), p_segment_id: segmentId });
  }

  reviewSuggestion({ reviewId, decision, correctedText = null }) {
    return this.rpc('caption_review_suggestion', { p_review_id: required(reviewId, 'reviewId'), p_decision: required(decision, 'decision'), p_corrected_text: correctedText });
  }

  recordScriptReview({ runId, segmentId, segmentOrder, sourceRevision, originalText, proposedText, matchedScriptId = null, providerItemId = null }) {
    return this.rpc('caption_record_script_review', {
      p_run_id: required(runId, 'runId'), p_segment_id: required(segmentId, 'segmentId'),
      p_segment_order: segmentOrder, p_source_revision: sourceRevision, p_original_text: required(originalText, 'originalText'),
      p_proposed_text: proposedText, p_matched_script_id: matchedScriptId, p_provider_item_id: providerItemId
    });
  }

  async claimApprovedReviews({ runId, modeGeneration, fencingToken, workerId, limit = 10 }) {
    const rows = await this.rpc('caption_claim_approved_reviews', {
      p_run_id: required(runId, 'runId'), p_mode_generation: modeGeneration, p_fencing_token: fencingToken,
      p_worker_id: required(workerId, 'workerId'), p_limit: limit
    });
    return Array.isArray(rows) ? rows.map(row => ({ ...row, reviewId: row.reviewId ?? row.id })) : [];
  }

  completeApprovedReview({ reviewId, workerId, error = null }) {
    return this.rpc('caption_complete_approved_review', {
      p_review_id: required(reviewId, 'reviewId'), p_worker_id: required(workerId, 'workerId'), p_error_code: error?.code || null
    });
  }

  upsertGlossary({ eventId, entry }) {
    return this.rpc('caption_upsert_glossary', { p_event_id: required(eventId, 'eventId'), p_entry: required(entry, 'entry') });
  }

  upsertScript({ eventId, script }) {
    return this.rpc('caption_upsert_script', { p_event_id: required(eventId, 'eventId'), p_script: required(script, 'script') });
  }

  health() { return this.rpc('caption_health'); }
}

module.exports = { CaptionStore, CaptionStoreError, camelise };
