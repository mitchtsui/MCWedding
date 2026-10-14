'use strict';

const { createHash } = require('node:crypto');
const { CaptionStore, CaptionStoreError } = require('../lib/captions/store.cjs');
const { CaptionDelivery } = require('../lib/captions/delivery.cjs');
const { createGuestSigner, guestLinksReady } = require('../lib/captions/guest-link.cjs');
const { OpenAITranslationClient } = require('../lib/captions/translation.cjs');
const { splitSpeech, translateCue, PreparedSpeechError } = require('../lib/captions/prepared-speech.cjs');
const { createOperatorAuth, assertSameOrigin } = require('../lib/captions/operator-auth.cjs');
const { HubAuthError, verifyHubSession } = require('../lib/hub-auth.cjs');
const { MAX_BODY_BYTES, requestId, bearerToken, assertOrigin, parseBody, rateLimit, guestRateLimit, takeGuestFailureSlot, returnGuestFailureSlot,
  scriptInput, scriptSelection, preparedRevision, preparedCursor, preparedTranslations, sendJson, sendError, allowedOrigins } = require('../lib/captions/http.cjs');

const LANGUAGES = new Set(['en', 'ja', 'zh-CN']);
const ADMIN_ACTIONS = new Set(['preflight','createEvent','start','pause','resume','end','stop','ticket','invite','manual','review','glossary',
  'scripts','script','select-scripts','prepared-cues','prepare-script','prepared-cue','review-prepared-cue',
  'select-prepared-script','prepared-run','next-prepared','publish-prepared-cue','clear-prepared','health']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function envEnabled(env) { return env.CAPTIONS_ENABLED === 'true'; }

function makeStore(env, fetchImpl) {
  if (!envEnabled(env)) throw new CaptionStoreError('CAPTIONS_DISABLED', 'Live captions are disabled', 503);
  return new CaptionStore({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl
  });
}

function requiredText(value, name, max = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new CaptionStoreError('INVALID_REQUEST', `${name} is invalid`, 400);
  }
  return value.trim();
}

function requiredLanguage(value) {
  if (!LANGUAGES.has(value)) throw new CaptionStoreError('INVALID_REQUEST', 'language is invalid', 400);
  return value;
}

function requiredUuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CaptionStoreError('INVALID_REQUEST', `${name} is invalid`, 400);
  return value;
}

// A venue of phones polls the same few rows, so guest reads are kept for a few seconds and concurrent
// requests share one database call. Like the rate-limit buckets in http.cjs, this is per serverless
// instance: each instance keeps its own bounded copy.
function createGuestReadCache({ max = 1000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get size() { return entries.size; },
    has(key) { const hit = entries.get(key); return Boolean(hit && hit.expiresAt > now()); },
    read(key, ttlMs, load, keepError = () => false) {
      const at = now();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > at) return hit.promise;
      entries.delete(key);
      if (entries.size >= max) {
        for (const [candidate, entry] of entries) if (entry.expiresAt <= at) entries.delete(candidate);
        while (entries.size >= max) entries.delete(entries.keys().next().value);
      }
      const entry = { promise: Promise.resolve().then(load), expiresAt: at + ttlMs };
      entries.set(key, entry);
      entry.promise.catch(error => { if (!keepError(error) && entries.get(key) === entry) entries.delete(key); });
      return entry.promise;
    }
  };
}

// Links this instance checked against the database in the last ten minutes. Holding one exempts a request
// from its IP's failure budget, so a client spraying guessed links from the hotel IP cannot lock out phones
// holding the real one. It is not a pass: the link is still re-checked on every read-cache miss.
function createRecentlyValid({ max = 1000, ttlMs = 600_000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    has(key) { const at = entries.get(key); return at !== undefined && now() - at < ttlMs; },
    mark(key) {
      entries.delete(key);
      if (entries.size >= max) entries.delete(entries.keys().next().value);
      entries.set(key, now());
    },
    forget(key) { entries.delete(key); }
  };
}

// One request's use of its IP's failure budget: a slot is held while the database is asked and kept only when
// the client was at fault (an invalid link or a run that is not the event's).
function guestFailureBudget(req) {
  let held = false;
  return {
    hold() {
      if (held) return;
      if (!takeGuestFailureSlot(req)) throw new CaptionStoreError('RATE_LIMITED', 'Too many requests', 429);
      held = true;
    },
    settle(error) {
      const clientFault = ['GUEST_LINK_INVALID', 'NOT_FOUND'].includes(error?.code);
      if (held && !clientFault) returnGuestFailureSlot(req);
      if (!held && clientFault) takeGuestFailureSlot(req);
    }
  };
}

function guestRequest(input) {
  const eventId = requiredUuid(input.eventId, 'eventId');
  const language = requiredLanguage(input.language);
  const token = requiredText(input.token, 'token', 512);
  const requestedRun = input.runId == null || input.runId === '' ? null : requiredUuid(input.runId, 'runId');
  return { eventId, language, token, requestedRun, linkKey: `${eventId}:${createHash('sha256').update(token).digest('hex')}` };
}

async function guestSnapshot({ store, signer, request, reads, valid, budget, now }) {
  const { eventId, language, token, requestedRun, linkKey } = request;
  if (!valid.has(linkKey)) budget.hold();
  // Refusals are kept too, so a flood of one bad link does not reach the database.
  const access = await reads.read(`access:${linkKey}`, 5000, () => store.guestAccess({ eventId, token }).catch(error => {
    throw error instanceof CaptionStoreError && error.details === '28000'
      ? new CaptionStoreError('GUEST_LINK_INVALID', 'This guest link has expired or is not valid', 403, '28000') : error;
  }), error => error.code === 'GUEST_LINK_INVALID').then(value => { valid.mark(linkKey); return value; }, error => {
    if (error.code === 'GUEST_LINK_INVALID') valid.forget(linkKey);
    throw error;
  });
  // The current run is always the one served, whatever run the phone names: it follows currentRunId, and a
  // made-up run id costs nothing. With no current run, a named run is looked up so a phone can still read a
  // run after it ends; a run that is not the event's is a client failure, also kept for two seconds.
  const runId = access.runId || requestedRun;
  const snapshotKey = `snapshot:${eventId}:${runId}:${language}`;
  if (!access.runId && requestedRun && !reads.has(snapshotKey)) budget.hold();
  const snapshot = runId ? await reads.read(snapshotKey, 2000,
    () => store.getSnapshotAsService({ eventId, runId, language }), error => error.code === 'NOT_FOUND') : null;
  const guest = { guestTopic: signer.topicFor(eventId, language), publicKey: signer.publicJwk, expiresAt: access.expiresAt, serverTime: now() };
  if (!snapshot) return { waiting: true, eventId, language, currentRunId: null, ...guest };
  return { ...snapshot, currentRunId: access.runId ?? null, ...guest };
}

// Postgres 22023 is the run refusing the action in its current state. The store reports it as the same
// 400 it uses for upstream 429/408, so it gets a code of its own that the operator page can act on.
function runNotOpen(error) {
  if (!(error instanceof CaptionStoreError) || error.details !== '22023') return error;
  return new CaptionStoreError('RUN_NOT_OPEN', 'Caption run is not open for that action', 409, '22023');
}

function scriptFeatureError(error) {
  if (!(error instanceof CaptionStoreError)) return error;
  if (error.details === 'PGRST202') {
    return new CaptionStoreError('CAPTIONS_MIGRATION_REQUIRED', 'Saved speech scripts need the latest database migration', 503);
  }
  if (error.details === '22001') {
    return new CaptionStoreError('SCRIPT_REFERENCE_TOO_LARGE', 'Selected scripts exceed the 12,000-character reference limit', 400);
  }
  return error;
}

function preparedFeatureError(error) {
  const migration = scriptFeatureError(error);
  if (migration !== error) return migration;
  if (error instanceof PreparedSpeechError) {
    const status = error.code === 'INVALID_REQUEST' ? 400 : error.code === 'PREPARATION_CANCELLED' ? 409 : 502;
    return new CaptionStoreError(error.code, error.message, status);
  }
  return error;
}

function preparedTranslator(env, fetchImpl) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new CaptionStoreError('PREPARATION_DISABLED', 'Prepared translation is not configured', 503);
  return new OpenAITranslationClient({ apiKey, model: env.OPENAI_TRANSLATION_MODEL || 'gpt-4.1-mini', fetchImpl });
}

function queryBody(req) {
  const url = new URL(req.url || '/api/captions.js', 'http://captions.local');
  return Object.fromEntries(url.searchParams.entries());
}

async function dispatchHttpOutbox({ store, delivery, outboxIds, workerId }) {
  const ids = Array.isArray(outboxIds) ? outboxIds.slice(0, 6) : [];
  if (!ids.length) return { attempted: 0, delivered: 0, queued: 0, errorCode: null };
  try {
    const rows = await store.claimHttpOutbox({ outboxIds: ids, workerId });
    const validated = [];
    for (const row of rows) {
      if (await store.validateHttpOutbox({ outboxId: row.id, workerId })) validated.push(row);
    }
    const results = await delivery.deliverMany(validated);
    await Promise.all(results.map(result => store.completeOutbox({
      outboxId: result.outboxId, workerId,
      error: result.delivered ? null : { code: result.errorCode }
    })));
    const delivered = results.filter(result => result.delivered).length;
    return {
      attempted: results.length,
      delivered,
      queued: ids.length - delivered,
      errorCode: results.find(result => !result.delivered)?.errorCode || (results.length < ids.length ? 'STALE_OUTBOX' : null)
    };
  } catch (error) {
    return { attempted: 0, delivered: 0, queued: ids.length, errorCode: error?.code || 'DELIVERY_UNAVAILABLE' };
  }
}

function createHandler({ env = process.env, fetchImpl = global.fetch, now = Date.now } = {}) {
  const reads = createGuestReadCache({ now });
  const valid = createRecentlyValid({ now });
  const operatorAuth = createOperatorAuth({ env, now });
  const requireHub = req => {
    let session;
    try { session = verifyHubSession(req, { env, now }); }
    catch (error) {
      if (error instanceof HubAuthError) throw new CaptionStoreError(error.code, error.message, error.status);
      throw error;
    }
    if (!session.authenticated) throw new CaptionStoreError('HUB_UNAUTHENTICATED', 'Wedding hub authentication is required', 401);
    return session;
  };
  return async function handler(req, res) {
    const id = requestId(req);
    let rate;
    try {
      if (!['GET','POST','OPTIONS'].includes(req.method)) throw new CaptionStoreError('METHOD_NOT_ALLOWED', 'Method is not allowed', 405);
      if (req.method === 'OPTIONS') {
        const origin = String(req.headers?.origin || '');
        if (!origin || !allowedOrigins(env).has(origin)) throw new CaptionStoreError('ORIGIN_FORBIDDEN', 'Request origin is not allowed', 403);
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Vary', 'Origin');
        res.statusCode = 204;
        res.end();
        return;
      }
      const input = req.method === 'GET' ? queryBody(req) : parseBody(req);
      const action = requiredText(input.action, 'action', 40);
      if (action !== 'operatorLogout') assertOrigin(req, env);
      if (req.method === 'GET' && !['config','snapshot','health','operatorStatus'].includes(action)) {
        throw new CaptionStoreError('METHOD_NOT_ALLOWED', 'Action requires POST', 405);
      }
      if (action === 'operatorLogout') {
        if (req.method !== 'POST') throw new CaptionStoreError('METHOD_NOT_ALLOWED', 'Action requires POST', 405);
        assertSameOrigin(req);
        res.setHeader('Set-Cookie', operatorAuth.clearCookie());
        sendJson(res, 200, { ok: true, requestId: id, data: { authenticated: false, expiresAt: null } });
        return;
      }
      if (!envEnabled(env)) throw new CaptionStoreError('CAPTIONS_DISABLED', 'Live captions are disabled', 503);
      if (action === 'operatorStatus') {
        if (req.method !== 'GET') throw new CaptionStoreError('METHOD_NOT_ALLOWED', 'Action requires GET', 405);
        requireHub(req);
        operatorAuth.ready();
        const session = operatorAuth.inspect(req);
        if (session.present && !session.authenticated) res.setHeader('Set-Cookie', operatorAuth.clearCookie());
        sendJson(res, 200, { ok: true, requestId: id, data: { authenticated: session.authenticated, expiresAt: session.expiresAt } });
        return;
      }
      if (action === 'operatorLogin') {
        if (req.method !== 'POST') throw new CaptionStoreError('METHOD_NOT_ALLOWED', 'Action requires POST', 405);
        assertSameOrigin(req);
        requireHub(req);
        const login = operatorAuth.login(req, input.password);
        res.setHeader('Set-Cookie', login.cookie);
        sendJson(res, 200, { ok: true, requestId: id, data: { authenticated: true, expiresAt: login.expiresAt } });
        return;
      }
      const store = makeStore(env, fetchImpl);
      // CAPTIONS_GUEST_LINKS=false stops every public guest broadcast, even with a signing key set.
      const delivery = new CaptionDelivery({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl,
        guestSigner: guestLinksReady(env) ? createGuestSigner(env) : null });
      if (action === 'config') {
        rate = rateLimit(req, action);
        const data = {
          enabled: true,
          guestLinksReady: guestLinksReady(env),
          supportedLanguages: [...LANGUAGES],
          maxPayloadBytes: MAX_BODY_BYTES
        };
        sendJson(res, 200, { ok: true, requestId: id, data }, rate);
        return;
      }
      // Guests hold only the link from the QR code, never a Supabase session.
      if (action === 'guestSnapshot') {
        if (!guestLinksReady(env)) throw new CaptionStoreError('GUEST_LINKS_DISABLED', 'Guest links are switched off', 503);
        rate = guestRateLimit(req, input.deviceId);
        let request;
        try { request = guestRequest(input); } catch (error) { takeGuestFailureSlot(req); throw error; }
        const budget = guestFailureBudget(req);
        let data;
        try {
          data = await guestSnapshot({ store, signer: createGuestSigner(env), request, reads, valid, budget, now });
          budget.settle(null);
        } catch (error) { budget.settle(error); throw error; }
        const origin = String(req.headers?.origin || '');
        if (origin && allowedOrigins(env).has(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        sendJson(res, 200, { ok: true, requestId: id, data }, rate);
        return;
      }
      const operatorSession = operatorAuth.inspect(req);
      if (operatorSession.present && !operatorSession.authenticated) res.setHeader('Set-Cookie', operatorAuth.clearCookie());
      const bearerSupplied = Boolean(String(req.headers?.authorization || '').trim());
      const passwordOperator = !bearerSupplied && operatorSession.authenticated && (ADMIN_ACTIONS.has(action) || action === 'snapshot');
      if (passwordOperator && req.method === 'POST') assertSameOrigin(req);
      if (passwordOperator) requireHub(req);
      const accessToken = passwordOperator ? null : bearerToken(req);
      const user = passwordOperator ? operatorSession
        : ADMIN_ACTIONS.has(action) ? await store.verifyAdmin(accessToken) : await store.verifyUser(accessToken);
      const rateIdentity = passwordOperator && action === 'snapshot' ? operatorSession.snapshotRateIdentity : user.id;
      rate = rateLimit(req, action, rateIdentity);
      let data;
      switch (action) {
        case 'preflight': {
          const health = await store.health();
          data = {
            enabled: true,
            guestLinksReady: guestLinksReady(env),
            ...health,
            warnings: guestLinksReady(env) ? [] : ['Guest links are switched off.']
          };
          break;
        }
        case 'createEvent':
          data = await store.createEvent({ title: requiredText(input.title, 'title', 160), settings: input.settings || {} });
          break;
        case 'start':
          try {
            data = await store.startRun({ eventId: input.eventId, mode: input.mode || 'live' });
          } catch (error) {
            // The reply to an earlier start can be lost after the run was created; reveal that run
            // so the operator is not left unable to start or stop.
            const runId = error instanceof CaptionStoreError && error.details === '23505'
              ? await store.getEventCurrentRun({ eventId: input.eventId }).catch(() => null) : null;
            if (!runId) throw error;
            const existing = await store.getRunState({ runId }).catch(() => null);
            data = { eventId: input.eventId, runId, mode: existing?.mode ?? null,
              state: existing?.state ?? existing?.status ?? null, alreadyOpen: true };
          }
          break;
        case 'pause': case 'resume': case 'end': case 'stop': {
          const transition = await store.transitionRun({ runId: input.runId, action }).catch(error => { throw runNotOpen(error); });
          const outboxIds = transition.deliveryOutboxIds || [];
          delete transition.deliveryOutboxIds;
          let pendingRecognizedFinals = {};
          if (action === 'end') {
            try {
              const recovered = await store.recoverPending({ runId: input.runId, limit: 500 });
              if (!recovered || !Array.isArray(recovered.finalSources)) throw new Error('Invalid pending-work response');
              const finalSources = recovered.finalSources;
              // Manual target-only captions intentionally have an empty source. They are not
              // unfinished AI translation work and must not make End report a false failure.
              const recognizedSources = finalSources.filter(source => typeof source?.text === 'string' && source.text.trim());
              pendingRecognizedFinals = { pendingRecognizedFinalSources: recognizedSources.length,
                pendingRecognizedFinalsTruncated: finalSources.length === 500, pendingRecognizedFinalsChecked: true };
            } catch {
              pendingRecognizedFinals = { pendingRecognizedFinalSources: null,
                pendingRecognizedFinalsTruncated: false, pendingRecognizedFinalsChecked: false };
            }
          }
          data = { ...transition, ...pendingRecognizedFinals,
            delivery: await dispatchHttpOutbox({ store, delivery, outboxIds, workerId: `${id}:http` }) };
          break;
        }
        case 'ticket': {
          const requestOrigin = String(req.headers.origin || '');
          if (input.origin && input.origin !== requestOrigin) throw new CaptionStoreError('ORIGIN_FORBIDDEN', 'Ticket origin does not match request origin', 403);
          data = await store.issueUplinkTicket({ runId: input.runId, origin: requestOrigin,
            accessToken: passwordOperator ? env.SUPABASE_SERVICE_ROLE_KEY : accessToken }).catch(error => { throw runNotOpen(error); });
          break;
        }
        case 'snapshot':
          data = passwordOperator
            ? await store.getSnapshotAsService({ eventId: input.eventId, runId: input.runId, language: requiredLanguage(input.language) })
            : await store.getSnapshot({ eventId: input.eventId, runId: input.runId, language: requiredLanguage(input.language), accessToken });
          break;
        case 'invite': {
          const expiresAt = new Date(input.expiresAt);
          const maxUses = Number(input.maxUses ?? 60);
          if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date() || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500) {
            throw new CaptionStoreError('INVALID_REQUEST', 'Invite expiry or usage limit is invalid', 400);
          }
          data = await store.createInvite({ eventId: input.eventId, expiresAt: expiresAt.toISOString(), maxUses });
          break;
        }
        case 'manual': {
          const manual = await store.publishManual({ runId: input.runId, language: requiredLanguage(input.language), text: requiredText(input.text, 'text'), segmentId: input.segmentId || null });
          const outboxIds = manual.deliveryOutboxIds || [];
          delete manual.deliveryOutboxIds;
          data = { ...manual, delivery: await dispatchHttpOutbox({ store, delivery, outboxIds, workerId: `${id}:http` }) };
          break;
        }
        case 'review':
          data = await store.reviewSuggestion({ reviewId: input.reviewId, decision: input.decision === 'approve' ? 'accepted' : input.decision === 'reject' ? 'rejected' : input.decision, correctedText: input.correctedText == null ? null : requiredText(input.correctedText, 'correctedText') });
          break;
        case 'glossary':
          data = await store.upsertGlossary({ eventId: input.eventId, entry: input.entry && { ...input.entry, sourceTerm: input.entry.sourceTerm || input.entry.text } });
          break;
        case 'scripts':
          data = await store.listScripts({ eventId: requiredUuid(input.eventId, 'eventId') }).catch(error => { throw scriptFeatureError(error); });
          break;
        case 'script': {
          const eventId = requiredUuid(input.eventId, 'eventId');
          // Guard before the write: an older database has caption_upsert_script but
          // lacks the saved/selected split and could otherwise activate a new script.
          await store.listScripts({ eventId }).catch(error => { throw scriptFeatureError(error); });
          data = await store.upsertScript({ eventId, script: scriptInput(input.script) }).catch(error => { throw scriptFeatureError(error); });
          break;
        }
        case 'select-scripts':
          data = await store.selectScripts({ eventId: requiredUuid(input.eventId, 'eventId'),
            scriptIds: scriptSelection(input.scriptIds) }).catch(error => { throw scriptFeatureError(error); });
          break;
        case 'prepared-cues': {
          const context = await store.getPreparedContext({ eventId: requiredUuid(input.eventId, 'eventId'),
            scriptId: requiredUuid(input.scriptId, 'scriptId') }).catch(error => { throw preparedFeatureError(error); });
          data = context.prepared;
          break;
        }
        case 'prepare-script': {
          const eventId = requiredUuid(input.eventId, 'eventId'), scriptId = requiredUuid(input.scriptId, 'scriptId');
          const context = await store.getPreparedContext({ eventId, scriptId }).catch(error => { throw preparedFeatureError(error); });
          let blocks;
          try { blocks = splitSpeech(context.content); } catch (error) { throw preparedFeatureError(error); }
          let prepared = await store.syncPreparedCues({ eventId, scriptId, scriptRevision: context.scriptRevision, cues: blocks })
            .catch(error => { throw preparedFeatureError(error); });
          const cue = prepared.cues.find(candidate => candidate.status === 'pending');
          if (!cue) { data = { ...prepared, done: true }; break; }
          let translated;
          try {
            translated = await translateCue({ translator: preparedTranslator(env, fetchImpl), source: cue.sourceText,
              prior: prepared.cues.filter(candidate => candidate.sequence < cue.sequence).map(candidate => candidate.sourceText),
              glossary: context.glossary });
          } catch (error) { throw preparedFeatureError(error); }
          prepared = await store.storePreparedTranslation({ eventId, cueId: cue.id, revision: cue.revision,
            translations: translated.translations }).catch(error => { throw preparedFeatureError(error); });
          data = { ...prepared, done: !prepared.cues.some(candidate => candidate.status === 'pending') };
          break;
        }
        case 'prepared-cue': {
          const cue = input.cue || {};
          data = await store.updatePreparedCue({ eventId: requiredUuid(input.eventId, 'eventId'),
            cueId: requiredUuid(cue.id, 'cue.id'), revision: preparedRevision(cue.revision, 'cue.revision'),
            translations: preparedTranslations(cue) }).catch(error => { throw preparedFeatureError(error); });
          break;
        }
        case 'review-prepared-cue':
          data = await store.reviewPreparedCue({ eventId: requiredUuid(input.eventId, 'eventId'),
            cueId: requiredUuid(input.cueId, 'cueId'), revision: preparedRevision(input.revision) })
            .catch(error => { throw preparedFeatureError(error); });
          break;
        case 'select-prepared-script':
          data = await store.selectPreparedScript({ runId: requiredUuid(input.runId, 'runId'),
            scriptId: requiredUuid(input.scriptId, 'scriptId') }).catch(error => { throw preparedFeatureError(error); });
          break;
        case 'prepared-run':
          data = await store.getPreparedRun({ runId: requiredUuid(input.runId, 'runId') })
            .catch(error => { throw preparedFeatureError(error); });
          break;
        case 'next-prepared': case 'publish-prepared-cue': case 'clear-prepared': {
          const runId = requiredUuid(input.runId, 'runId'), operationId = requiredUuid(input.operationId, 'operationId');
          const expectedScriptId = requiredUuid(input.expectedScriptId, 'expectedScriptId');
          const expectedCursor = preparedCursor(input.expectedCursor);
          const scriptRevision = preparedRevision(input.expectedScriptRevision, 'expectedScriptRevision');
          const expectedStateRevision = preparedRevision(input.expectedStateRevision, 'expectedStateRevision');
          const prepared = action === 'clear-prepared'
            ? await store.clearPrepared({ runId, operationId, expectedScriptId, expectedCursor, scriptRevision, expectedStateRevision })
              .catch(error => { throw preparedFeatureError(error); })
            : await store.publishPreparedCue({ runId, operationId,
              cueId: action === 'publish-prepared-cue' ? requiredUuid(input.cueId, 'cueId') : null,
              expectedScriptId, expectedCursor, scriptRevision, expectedStateRevision })
              .catch(error => { throw preparedFeatureError(error); });
          const outboxIds = prepared.deliveryOutboxIds || [];
          delete prepared.deliveryOutboxIds;
          const replayed = prepared.replayed === true;
          delete prepared.replayed;
          const delivered = await dispatchHttpOutbox({ store, delivery, outboxIds, workerId: `${id}:http` });
          if (replayed && delivered.errorCode === 'STALE_OUTBOX') {
            Object.assign(delivered, { queued: 0, errorCode: null, replayed: true });
          }
          data = { ...prepared, delivery: delivered };
          break;
        }
        case 'health':
          data = await store.health();
          break;
        default:
          throw new CaptionStoreError('UNKNOWN_ACTION', 'Caption action is not supported', 404);
      }
      const origin = String(req.headers?.origin || '');
      if (origin && allowedOrigins(env).has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      sendJson(res, 200, { ok: true, requestId: id, data }, rate);
    } catch (error) {
      sendError(res, id, error);
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.envEnabled = envEnabled;
module.exports.guestLinksReady = guestLinksReady;
module.exports.dispatchHttpOutbox = dispatchHttpOutbox;
module.exports.createGuestReadCache = createGuestReadCache;
