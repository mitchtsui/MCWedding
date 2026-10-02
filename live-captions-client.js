(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CaptionsLive = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const languages = ['en', 'ja', 'zh-CN'];
  const statuses = ['draft', 'final', 'corrected', 'unavailable'];

  function cleanError(value, fallback) {
    const text = typeof value === 'string' ? value : fallback;
    return String(text || 'Request failed').replace(/[\r\n]/g, ' ').slice(0, 180);
  }

  function fragmentToken(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    return params.get('token') || params.get('caption_token') || '';
  }

  function fragmentEventId(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    return params.get('event') || params.get('eventId') || '';
  }

  function fragmentRunId(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    return params.get('run') || params.get('runId') || '';
  }

  function clearFragment(historyObject, locationObject) {
    if (!locationObject.hash) return;
    historyObject.replaceState(null, '', locationObject.pathname + locationObject.search);
  }

  class CaptionStore {
    constructor(onGap) {
      this.onGap = onGap || function () {};
      this.values = new Map(); this.eventId = ''; this.runId = '';
      this.modeGeneration = -1; this.channelEpoch = ''; this.retiredEpochs = new Set(); this.messageSeq = -1; this.status = '';
    }
    reset() { this.values.clear(); this.runId = ''; this.modeGeneration = -1; this.channelEpoch = ''; this.retiredEpochs.clear(); this.messageSeq = -1; this.status = ''; }
    merge(batch) {
      if (!batch || typeof batch !== 'object' || !Array.isArray(batch.updates)) return false;
      const generation = Number(batch.modeGeneration), epoch = batch.channelEpoch, seq = Number(batch.messageSeq);
      if (!Number.isSafeInteger(generation) || typeof epoch !== 'string' || !epoch || !Number.isSafeInteger(seq) || seq < 0) return false;
      if (this.eventId && batch.eventId !== this.eventId) return false;
      if (this.runId && batch.runId !== this.runId) return false;
      if (this.modeGeneration > generation) return false;
      if (this.retiredEpochs.has(epoch)) return false;
      const epochChanged = Boolean(this.channelEpoch && this.channelEpoch !== epoch);
      const cursorChanged = generation !== this.modeGeneration || epochChanged || seq > this.messageSeq || batch.status !== this.status;
      if (generation > this.modeGeneration || epochChanged) this.messageSeq = -1;
      if (epochChanged) { this.retiredEpochs.add(this.channelEpoch); this.onGap({ reason: 'epoch_changed', previousEpoch: this.channelEpoch, receivedEpoch: epoch }); }
      if (this.messageSeq >= 0 && seq > this.messageSeq + 1) this.onGap({ reason: 'sequence_gap', expected: this.messageSeq + 1, received: seq });
      this.eventId = String(batch.eventId || ''); this.runId = String(batch.runId || '');
      this.modeGeneration = generation; this.channelEpoch = epoch; this.messageSeq = Math.max(this.messageSeq, seq); this.status = typeof batch.status === 'string' ? batch.status : '';
      let changed = false; for (const update of batch.updates) changed = this.mergeUpdate(update) || changed;
      return changed || cursorChanged;
    }
    mergeUpdate(update) {
      if (!update || !languages.includes(update.language) || !statuses.includes(update.status)
          || typeof update.segmentId !== 'string' || !Number.isSafeInteger(update.segmentOrder)
          || !Number.isSafeInteger(update.sourceRevision) || !Number.isSafeInteger(update.captionRevision)
          || typeof update.text !== 'string') return false;
      const key = update.segmentId + ':' + update.language, current = this.values.get(key);
      if (current?.status === 'corrected' && current.origin === 'manual'
          && (update.status !== 'corrected' || update.origin !== 'manual')) return false;
      if (current && ['final', 'corrected'].includes(current.status) && update.status === 'draft') return false;
      if (current && (update.sourceRevision < current.sourceRevision
          || (update.sourceRevision === current.sourceRevision && update.captionRevision <= current.captionRevision))) return false;
      this.values.set(key, Object.freeze({ ...update }));
      return true;
    }
    segments(language) {
      return [...this.values.values()].filter(value => value.language === language)
        .sort((a, b) => a.segmentOrder - b.segmentOrder);
    }
  }

  function create(options) {
    const fetchImpl = options?.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const endpoint = options?.endpoint || '/api/captions.js';
    if (!fetchImpl) throw new Error('Fetch unavailable');
    async function request(action, payload, accessToken) {
      const isPublicConfig = action === 'config';
      const headers = isPublicConfig ? {} : { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
      let response;
      try {
        response = await fetchImpl(isPublicConfig ? endpoint + (endpoint.includes('?') ? '&' : '?') + 'action=config' : endpoint,
          { method: isPublicConfig ? 'GET' : 'POST', headers, credentials: 'same-origin',
            ...(isPublicConfig ? {} : { body: JSON.stringify({ action, ...(payload || {}) }) }) });
      } catch { throw new Error('Caption service unavailable'); }
      let body;
      try { body = await response.json(); } catch { throw new Error('Caption service returned invalid data'); }
      if (!response.ok || !body || body.ok !== true) {
        throw Object.assign(new Error(cleanError(body?.error?.message || body?.error, 'Caption request failed')),
          { status: response.status, code: typeof body?.error?.code === 'string' ? body.error.code : '' });
      }
      return body.data || {};
    }
    return Object.freeze({ request });
  }

  function createSupabase(globalObject, storageKey, detectSessionInUrl = true) {
    if (!globalObject?.supabase?.createClient || !globalObject.SUPABASE_URL || !globalObject.SUPABASE_ANON_KEY) return null;
    const auth = { persistSession: true, detectSessionInUrl, autoRefreshToken: true };
    if (storageKey) auth.storageKey = storageKey;
    return globalObject.supabase.createClient(globalObject.SUPABASE_URL, globalObject.SUPABASE_ANON_KEY, { auth });
  }

  async function accessToken(client) {
    const result = await client.auth.getSession();
    return result?.data?.session?.access_token || '';
  }

  function keepRealtimeAuth(client) {
    const result = client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token && client.realtime?.setAuth) client.realtime.setAuth(session.access_token);
    });
    return () => result?.data?.subscription?.unsubscribe?.();
  }

  function heartbeatNeedsSnapshot(store, value) {
    if (!store || !value) return false;
    const generation = Number(value.modeGeneration), sequence = Number(value.messageSeq);
    if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(sequence) || typeof value.channelEpoch !== 'string') return false;
    if (generation < store.modeGeneration || store.retiredEpochs.has(value.channelEpoch)) return false;
    return generation > store.modeGeneration || value.channelEpoch !== store.channelEpoch || sequence > store.messageSeq;
  }

  async function currentSnapshot(request, scope) {
    let value = await request('snapshot', scope);
    if (value.currentRunId && value.currentRunId !== scope.runId) {
      const nextRunId = value.currentRunId;
      value = await request('snapshot', { ...scope, runId: nextRunId });
      if (value.runId !== nextRunId || value.eventId !== scope.eventId || value.language !== scope.language) {
        throw new Error('Caption session could not be synchronized');
      }
    }
    return value;
  }

  // Guest phones have no account: their channel is public, and every message on it is signed by the server.
  function subscribe(client, topic, onBatch, onStatus, onHeartbeat, options) {
    const channel = client.channel(topic, { config: { private: options?.private !== false } });
    channel.on('broadcast', { event: 'caption.batch' }, message => onBatch(message.payload || message));
    if (onHeartbeat) channel.on('broadcast', { event: 'heartbeat' }, message => onHeartbeat(message.payload || message));
    channel.subscribe(status => onStatus?.(status));
    return { channel, close: () => client.removeChannel(channel) };
  }

  async function importGuestKey(jwk, subtle = globalThis.crypto?.subtle) {
    if (!subtle) throw new Error('This browser cannot check caption signatures');
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new Error('Caption signing key is invalid');
    return subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }

  function base64UrlBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  }

  // Returns the signed payload, or null for anything not signed by the caption server.
  async function openEnvelope(key, envelope, subtle = globalThis.crypto?.subtle) {
    if (!key || !subtle || !envelope || typeof envelope.data !== 'string' || typeof envelope.sig !== 'string' || envelope.data.length > 262144 || !/^[A-Za-z0-9_-]{80,90}$/.test(envelope.sig)) return null;
    let signature; try { signature = base64UrlBytes(envelope.sig); } catch { return null; }
    if (signature.length !== 64) return null;
    let valid = false; try { valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(envelope.data)); } catch { return null; }
    if (!valid) return null;
    try { return JSON.parse(envelope.data); } catch { return null; }
  }

  return Object.freeze({ languages, CaptionStore, create, createSupabase, accessToken,
    keepRealtimeAuth, heartbeatNeedsSnapshot, currentSnapshot, subscribe, fragmentToken, fragmentEventId, fragmentRunId, clearFragment, cleanError,
    importGuestKey, openEnvelope });
}));
