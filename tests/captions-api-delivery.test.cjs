'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptionDelivery, guestPayload } = require('../lib/captions/delivery.cjs');
const { createHandler } = require('../api/captions.js');

function response(status, payload = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

function req(body) {
  return {
    method: 'POST', url: '/api/captions.js', body,
    headers: { origin: 'https://wedding.test', authorization: 'Bearer user-jwt', 'x-forwarded-for': '203.0.113.245' },
    socket: {}
  };
}

function res() {
  return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(value='') { this.body=value; } };
}

const env = {
  CAPTIONS_ENABLED: 'true', CAPTIONS_ALLOWED_ORIGINS: 'https://wedding.test',
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret'
};

function captionPayload(overrides = {}) {
  return {
    schemaVersion: 1, type: 'caption.batch', eventId: 'event-1', runId: 'run-1',
    modeGeneration: 2, channelEpoch: 'epoch-1', messageSeq: 3, language: 'en',
    updates: [], _fencingToken: 9, sourceText: 'must not leave server', ...overrides
  };
}

test('delivery strips internal/source fields and sends a private Supabase Broadcast', async () => {
  const calls = [];
  const delivery = new CaptionDelivery({ supabaseUrl:'https://test.supabase.co',serviceRoleKey:'secret',fetchImpl:async (url,options) => {
    calls.push({url,options}); return response(202);
  }});
  const result = await delivery.deliver({ id:'outbox-1',payload:captionPayload() });
  assert.equal(result.delivered,true);
  assert.match(calls[0].url,/\/realtime\/v1\/api\/broadcast\/caption%3Aevent-1%3Aen\/events\/caption\.batch\?private=true$/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body._fencingToken,undefined);
  assert.equal(body.sourceText,undefined);
  assert.equal(calls[0].options.headers.apikey,'secret');
});

test('delivery timeout is bounded and sanitized', async () => {
  const delivery = new CaptionDelivery({ supabaseUrl:'https://test.supabase.co',serviceRoleKey:'secret',timeoutMs:5,
    fetchImpl:async (_url,options) => new Promise((_resolve,reject) => options.signal.addEventListener('abort',() => reject(new Error('secret detail')),{once:true})) });
  const result = await delivery.deliver({ id:'outbox-1',payload:captionPayload() });
  assert.deepEqual(result,{outboxId:'outbox-1',delivered:false,errorCode:'REALTIME_UNAVAILABLE'});
});

test('pause changes state then delivers all three queued status batches without a gateway', async () => {
  const realtime = [], completed = [];
  const fetchImpl = async (url,options={}) => {
    if (url.endsWith('/auth/v1/user')) return response(200,{id:'admin'});
    if (url.endsWith('/rpc/is_admin')) return response(200,true);
    if (url.endsWith('/rpc/caption_transition_run')) return response(200,{run_id:'run-1',event_id:'event-1',state:'paused',mode_generation:2,channel_epoch:'epoch-1',fencing_token:4,delivery_outbox_ids:['o-en','o-ja','o-zh']});
    if (url.endsWith('/rpc/caption_claim_http_outbox')) return response(200,['en','ja','zh-CN'].map((language,index) => ({id:`o-${index}`,payload:captionPayload({language,messageSeq:index+1,status:'paused'})})));
    if (url.endsWith('/rpc/caption_validate_http_outbox')) return response(200,true);
    if (url.endsWith('/rpc/caption_complete_outbox')) { completed.push(JSON.parse(options.body)); return response(200,{status:'sent'}); }
    if (url.includes('/realtime/v1/api/broadcast/')) { realtime.push(url); return response(202); }
    throw new Error(`unexpected ${url}`);
  };
  const handler = createHandler({env,fetchImpl});
  const output = res();
  await handler(req({action:'pause',runId:'run-1'}),output);
  const body = JSON.parse(output.body);
  assert.equal(output.statusCode,200);
  assert.deepEqual(body.data.delivery,{attempted:3,delivered:3,queued:0,errorCode:null});
  assert.equal(realtime.length,3);
  assert.equal(completed.length,3);
});

test('manual caption stays queued and API reports failure when Realtime is unavailable', async () => {
  const completed = [];
  const fetchImpl = async (url,options={}) => {
    if (url.endsWith('/auth/v1/user')) return response(200,{id:'admin'});
    if (url.endsWith('/rpc/is_admin')) return response(200,true);
    if (url.endsWith('/rpc/caption_manual_publish')) return response(200,{segment_id:'s',caption_revision:2,delivery_outbox_ids:['o-manual']});
    if (url.endsWith('/rpc/caption_claim_http_outbox')) return response(200,[{id:'o-manual',payload:captionPayload({updates:[{segmentId:'s',segmentOrder:1,sourceRevision:2,captionRevision:2,status:'corrected',origin:'manual',text:'Manual text',language:'en'}]})}]);
    if (url.endsWith('/rpc/caption_validate_http_outbox')) return response(200,true);
    if (url.endsWith('/rpc/caption_complete_outbox')) { completed.push(JSON.parse(options.body)); return response(200,{status:'failed'}); }
    if (url.includes('/realtime/v1/api/broadcast/')) return response(503);
    throw new Error(`unexpected ${url}`);
  };
  const handler = createHandler({env,fetchImpl});
  const output = res();
  await handler(req({action:'manual',runId:'run-1',language:'en',text:'Manual text'}),output);
  const body = JSON.parse(output.body);
  assert.equal(output.statusCode,200);
  assert.deepEqual(body.data.delivery,{attempted:1,delivered:0,queued:1,errorCode:'REALTIME_HTTP_503'});
  assert.equal(completed[0].p_error_code,'REALTIME_HTTP_503');
});

test('guest payload helper only exposes target-caption protocol fields', () => {
  const payload = guestPayload(captionPayload({updates:[{segmentId:'s',text:'Target only',sourceText:'secret',debug:'secret',language:'en'}]}));
  assert.deepEqual(Object.keys(payload.updates[0]),['segmentId','segmentOrder','sourceRevision','captionRevision','status','origin','text','language']);
  assert.equal(JSON.stringify(payload).includes('secret'),false);
});
