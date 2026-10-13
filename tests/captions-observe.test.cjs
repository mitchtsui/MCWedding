const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig, observe, TABLES } = require('../scripts/captions-observe.cjs');
const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const config = { origin: 'https://test-project.supabase.co', key: 'test-service-secret' };
const preview = 'https://test-preview.vercel.app';

function fakeFetch(calls, mismatch = false) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/config.js')) return new Response(`window.SUPABASE_URL="${mismatch ? 'https://other.supabase.co' : config.origin}";`);
    const table = new URL(url).pathname.split('/').at(-1);
    const records = {
      caption_runs: [{ id: runId, state: 'ended', mode_generation: 2, text: 'PRIVATE' }],
      caption_source_segments: [{ segment_id: 'one', status: 'final', source_revision: 2 }],
      caption_captions: [
        { segment_id: 'one', language: 'en', status: 'final', source_revision: 1 },
        { segment_id: 'one', language: 'ja', status: 'corrected', source_revision: 2 },
        { segment_id: 'one', language: 'zh-CN', status: 'unavailable', source_revision: 2 }
      ],
      caption_outbox_events: [{ status: 'pending', payload: 'PRIVATE' }],
      caption_uplink_tickets: [{ used_at: '2026-10-03T00:00:00Z', token_hash: 'PRIVATE' }, { used_at: null }],
      caption_operational_events: [{ type: 'stream_gap', details_safe: { text: 'PRIVATE' } }]
    };
    const rows = records[table];
    return new Response(JSON.stringify(rows), { headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } });
  };
}

test('observation is GET-only, scoped to one run, with no content or credentials in report', async () => {
  const calls = [];
  const report = await observe({ config, preview, runId, fetchImpl: fakeFetch(calls) });
  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    if (call.url.includes('/rest/v1/')) {
      const url = new URL(call.url);
      assert.equal(url.searchParams.get(url.pathname.endsWith('/caption_runs') ? 'id' : 'run_id'), `eq.${runId}`);
      assert.doesNotMatch(url.searchParams.get('select'), /(?:^|,)(?:text|payload|token_hash|user_id|details_safe)(?:,|$)/);
    } else assert.deepEqual(call.options.headers, {});
  }
  assert.deepEqual(report.incompleteTables, []);
  assert.equal(report.languages.en.finalSourcesWithoutCurrentFinal, 1);
  assert.equal(report.languages.ja.finalSourcesWithoutCurrentFinal, 0);
  assert.equal(report.languages['zh-CN'].finalSourcesWithoutCurrentFinal, 1);
  assert.equal(report.usedUplinkTimes.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|test-service-secret/);
});

test('wrong project, invalid run and redirects fail before any credential-bearing request', async () => {
  const calls = [];
  await assert.rejects(observe({ config, preview, runId, fetchImpl: fakeFetch(calls, true) }), /does not match/);
  assert.equal(calls.length, 1);
  await assert.rejects(observe({ config, preview, runId: 'x&select=*', fetchImpl: fakeFetch(calls) }), /UUID/);
  assert.equal(calls.length, 1);
  await assert.rejects(observe({ config, preview, runId, fetchImpl: async () => { throw new Error('SECRET'); } }), /request failed/);
});

test('local config uses only its file and requires the hosted project origin', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-observe-'));
  try {
    fs.writeFileSync(path.join(directory, '.env.local'), `SUPABASE_URL=${config.origin}\nSUPABASE_SERVICE_ROLE_KEY=local-only\n`);
    assert.deepEqual(readConfig(directory), { origin: config.origin, key: 'local-only' });
    fs.writeFileSync(path.join(directory, '.env.local'), 'SUPABASE_URL=https://wrong.example\nSUPABASE_SERVICE_ROLE_KEY=local-only');
    assert.throws(() => readConfig(directory), /hosted Supabase/);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('missing exact counts are explicitly incomplete', async () => {
  const base = fakeFetch([]);
  const report = await observe({ config, preview, runId, fetchImpl: async (...args) => {
    const response = await base(...args); response.headers.delete('content-range'); return response;
  } });
  assert.deepEqual(report.incompleteTables.sort(), Object.keys(TABLES).sort());
});

test('malformed database responses cannot escape as logged speech or secrets', async () => {
  const base = fakeFetch([]);
  await assert.rejects(observe({ config, preview, runId, fetchImpl: async (url, options) => {
    return url.includes('/rest/v1/') ? new Response('PRIVATE_RESPONSE_MARKER') : base(url, options);
  } }), error => !error.message.includes('PRIVATE') && /body omitted/.test(error.message));
});

test('corrected source coverage requires its exact current revision', async () => {
  const base = fakeFetch([]);
  const report = await observe({ config, preview, runId, fetchImpl: async (url, options) => {
    const response = await base(url, options);
    if (!url.includes('/caption_source_segments?')) return response;
    const rows = await response.json(); rows[0].status = 'corrected'; rows[0].source_revision = 3;
    return new Response(JSON.stringify(rows), { headers: response.headers });
  } });
  for (const language of Object.values(report.languages)) assert.equal(language.finalSourcesWithoutCurrentFinal, 1);
});

test('exact page boundaries stop before out-of-range requests; large runs are explicitly capped', async () => {
  for (const total of [500, 1000, 10001]) {
    const base = fakeFetch([]), offsets = [];
    const report = await observe({ config, preview, runId, fetchImpl: async (url, options) => {
      if (!url.includes('/caption_operational_events?')) return base(url, options);
      const offset = Number(new URL(url).searchParams.get('offset')); offsets.push(offset);
      if (offset >= total) return new Response('', { status: 416 });
      const rows = Array.from({ length: Math.min(500, total - offset) }, () => ({ type: 'asr_timing' }));
      return new Response(JSON.stringify(rows), { headers: { 'content-range': `${offset}-${offset + rows.length - 1}/${total}` } });
    } });
    assert.equal(offsets.length, Math.min(20, Math.ceil(total / 500)));
    assert.equal(report.operationalTypes.asr_timing, Math.min(10000, total));
    assert.equal(report.incompleteTables.includes('caption_operational_events'), total > 10000);
  }
});
