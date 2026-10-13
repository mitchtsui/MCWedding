'use strict';

const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { CaptionGateway, SupabaseBroadcastPublisher } = require('../lib/captions/gateway.cjs');
const { OpenAIRealtimeAsr } = require('../lib/captions/asr.cjs');
const { OpenAITranslationClient } = require('../lib/captions/translation.cjs');
const { OpenAIScriptAssistant } = require('../lib/captions/script-assist.cjs');
const { createGuestSigner, guestLinksReady } = require('../lib/captions/guest-link.cjs');

function splitOrigins(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function createCaptionsStreamServer({ gateway, WebSocketServerImpl = WebSocketServer, enabled = true }) {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (!enabled) {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false, error: { code: 'live_captions_disabled', message: 'Live captions are not enabled.' } }));
      return;
    }
    response.statusCode = 426;
    response.setHeader('Upgrade', 'websocket');
    response.end(JSON.stringify({ ok: false, error: { code: 'websocket_required', message: 'Use a WebSocket connection.' } }));
  });
  const wss = new WebSocketServerImpl({
    server,
    maxPayload: 8 * 1024,
    perMessageDeflate: false,
    verifyClient: ({ origin }, done) => {
      if (!enabled) return done(false, 503, 'Live captions disabled');
      if (!gateway.acceptsOrigin(origin)) return done(false, 403, 'Origin denied');
      done(true);
    },
  });
  wss.on('connection', (socket, request) => gateway.attach(socket, { origin: request.headers.origin }));
  server.on('close', () => wss.close());
  server.captionsGateway = gateway;
  return server;
}

function createRuntimeFromEnv(env = process.env) {
  const enabled = env.CAPTIONS_ENABLED === 'true';
  const origins = splitOrigins(env.CAPTIONS_ALLOWED_ORIGINS);
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];
  if (!enabled || required.some(name => !String(env[name] || '').trim()) || !origins.length) {
    const unavailableGateway = { acceptsOrigin: () => false, attach: () => { throw new Error('Live captions disabled'); } };
    return createCaptionsStreamServer({ gateway: unavailableGateway, enabled: false });
  }
  const { CaptionStore } = require('../lib/captions/store.cjs');
  const store = new CaptionStore({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const publisher = new SupabaseBroadcastPublisher({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    guestSigner: guestLinksReady(env) ? createGuestSigner(env) : null });
  const translator = new OpenAITranslationClient({ apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_TRANSLATION_MODEL || 'gpt-4.1-mini' });
  const scriptAssistant = new OpenAIScriptAssistant({ apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_TRANSLATION_MODEL || 'gpt-4.1-mini' });
  const rotateAfterMs = boundedNumber(env.CAPTIONS_ROTATE_AFTER_MS, 240000, 30000, 270000);
  const shutdownAfterMs = Math.max(rotateAfterMs + 15000,
    boundedNumber(env.CAPTIONS_MAX_SESSION_MS, 285000, 60000, 295000));
  const gateway = new CaptionGateway({
    store,
    publisher,
    translator,
    scriptAssistant,
    allowedOrigins: origins,
    config: {
      commitMode: env.CAPTIONS_COMMIT_MODE === 'fixed' ? 'fixed' : 'pause',
      fixedCommitMs: boundedNumber(env.CAPTIONS_FIXED_COMMIT_MS, 4000, 1000, 6000),
      turnSilenceMs: boundedNumber(env.CAPTIONS_PAUSE_MS, 450, 200, 1000),
      turnMaxMs: boundedNumber(env.CAPTIONS_MAX_TURN_MS, 6000, 2000, 10000),
      vadRmsThreshold: boundedNumber(env.CAPTIONS_VAD_RMS_THRESHOLD, 0.012, 0.001, 0.2),
      rotateAfterMs,
      shutdownAfterMs,
    },
    asrFactory: ({ glossary }) => new OpenAIRealtimeAsr({
      apiKey: env.OPENAI_API_KEY,
      WebSocket,
      model: env.OPENAI_ASR_MODEL || 'gpt-live-transcribe',
      languages: ['yue', 'en'],
      delay: env.OPENAI_ASR_DELAY === 'minimal' ? 'minimal' : 'low',
      prompt: String(env.CAPTIONS_ASR_PROMPT || '').slice(0, 1000),
      keywords: glossary.flatMap(entry => [entry.sourceTerm, ...(entry.aliases ?? [])])
        .filter(term => typeof term === 'string' && term.trim() && term.length <= 100 && !/[<>\r\n]/.test(term))
        .map(term => term.trim()).slice(0, 100),
    }),
  });
  return createCaptionsStreamServer({ gateway, enabled: true });
}

const server = createRuntimeFromEnv();
server.maxDuration = 300;
server.createCaptionsStreamServer = createCaptionsStreamServer;
server.createRuntimeFromEnv = createRuntimeFromEnv;
server.splitOrigins = splitOrigins;
server.boundedNumber = boundedNumber;

module.exports = server;
