'use strict';

const { CaptionStore, CaptionStoreError } = require('../lib/captions/store.cjs');
const { CaptionDelivery } = require('../lib/captions/delivery.cjs');
const { MAX_BODY_BYTES, requestId, bearerToken, assertOrigin, parseBody, rateLimit, sendJson, sendError, allowedOrigins } = require('../lib/captions/http.cjs');

const LANGUAGES = new Set(['en', 'ja', 'zh-CN']);
const ADMIN_ACTIONS = new Set(['preflight','createEvent','start','pause','resume','end','stop','ticket','invite','manual','review','glossary','script','health']);

function envEnabled(env) { return env.CAPTIONS_ENABLED === 'true'; }
function guestAuthReady(env) { return env.CAPTIONS_GUEST_AUTH_AUDITED === 'true'; }

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

// Postgres 22023 is the run refusing the action in its current state. The store reports it as the same
// 400 it uses for upstream 429/408, so it gets a code of its own that the operator page can act on.
function runNotOpen(error) {
  if (!(error instanceof CaptionStoreError) || error.details !== '22023') return error;
  return new CaptionStoreError('RUN_NOT_OPEN', 'Caption run is not open for that action', 409, '22023');
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

function createHandler({ env = process.env, fetchImpl = global.fetch } = {}) {
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
      assertOrigin(req, env);
      const input = req.method === 'GET' ? queryBody(req) : parseBody(req);
      const action = requiredText(input.action, 'action', 40);
      if (req.method === 'GET' && !['config','snapshot','health'].includes(action)) {
        throw new CaptionStoreError('METHOD_NOT_ALLOWED', 'Action requires POST', 405);
      }
      const store = makeStore(env, fetchImpl);
      const delivery = new CaptionDelivery({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl });
      if (action === 'config') {
        rate = rateLimit(req, action);
        const data = {
          enabled: true,
          guestAuthReady: guestAuthReady(env),
          supportedLanguages: [...LANGUAGES],
          maxPayloadBytes: MAX_BODY_BYTES
        };
        sendJson(res, 200, { ok: true, requestId: id, data }, rate);
        return;
      }
      const accessToken = bearerToken(req);
      const user = ADMIN_ACTIONS.has(action) ? await store.verifyAdmin(accessToken) : await store.verifyUser(accessToken);
      rate = rateLimit(req, action, user.id);
      let data;
      switch (action) {
        case 'preflight': {
          const health = await store.health();
          data = {
            enabled: true,
            guestAuthReady: guestAuthReady(env),
            ...health,
            warnings: guestAuthReady(env) ? [] : ['Guest caption access is awaiting an Auth and RLS audit.']
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
            data = { eventId: input.eventId, runId, alreadyOpen: true };
          }
          break;
        case 'pause': case 'resume': case 'end': case 'stop': {
          const transition = await store.transitionRun({ runId: input.runId, action }).catch(error => { throw runNotOpen(error); });
          const outboxIds = transition.deliveryOutboxIds || [];
          delete transition.deliveryOutboxIds;
          data = { ...transition, delivery: await dispatchHttpOutbox({ store, delivery, outboxIds, workerId: `${id}:http` }) };
          break;
        }
        case 'ticket': {
          const requestOrigin = String(req.headers.origin || '');
          if (input.origin && input.origin !== requestOrigin) throw new CaptionStoreError('ORIGIN_FORBIDDEN', 'Ticket origin does not match request origin', 403);
          data = await store.issueUplinkTicket({ runId: input.runId, origin: requestOrigin, accessToken }).catch(error => { throw runNotOpen(error); });
          break;
        }
        case 'snapshot':
          data = await store.getSnapshot({ eventId: input.eventId, runId: input.runId, language: requiredLanguage(input.language), accessToken });
          break;
        case 'redeem':
          if (!guestAuthReady(env)) throw new CaptionStoreError('GUEST_AUTH_NOT_READY', 'Guest caption access is not ready', 503);
          data = await store.redeemInvite({ eventId: input.eventId, token: requiredText(input.token, 'token', 512), accessToken });
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
        case 'script':
          data = await store.upsertScript({ eventId: input.eventId, script: input.script });
          break;
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
module.exports.guestAuthReady = guestAuthReady;
module.exports.dispatchHttpOutbox = dispatchHttpOutbox;
