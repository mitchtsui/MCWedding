// Read-only, one-run evidence. Never select audio, text, tokens, or outbox payloads.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES = {
  caption_runs: 'id,state,mode_generation,channel_epoch,fencing_token,started_at,ended_at',
  caption_source_segments: 'segment_id,segment_order,source_revision,status',
  caption_captions: 'segment_id,language,status,source_revision',
  caption_outbox_events: 'status',
  caption_uplink_tickets: 'used_at',
  caption_operational_events: 'type,created_at'
};

function readConfig(root) {
  // Deliberately do not merge process.env: it can target another project.
  const env = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
      || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Expected the hosted Supabase project origin in .env.local');
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing local Supabase service key');
  return { origin: url.origin, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function observe({ config, preview, runId, fetchImpl = fetch }) {
  if (!UUID.test(runId || '')) throw new Error('Provide one explicit run UUID');
  const site = new URL(preview);
  if (site.protocol !== 'https:' || site.username || site.password || !site.hostname.endsWith('.vercel.app')) {
    throw new Error('Expected an HTTPS Vercel preview URL');
  }
  const request = async (url, headers = {}) => {
    let response;
    try { response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Observation request failed; no credentials or response body logged'); }
    if (!response.ok) throw new Error(`Observation HTTP ${response.status}`);
    return response;
  };
  const publicConfig = await (await request(`${site.origin}/api/config.js`)).text();
  const match = publicConfig.match(/window\.SUPABASE_URL=("(?:[^"\\]|\\.)*");/);
  if (!match || JSON.parse(match[1]).replace(/\/+$/, '') !== config.origin) {
    throw new Error('Local Supabase project does not match this preview; observation refused');
  }
  const data = {};
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}`, Prefer: 'count=exact' };
  for (const [table, columns] of Object.entries(TABLES)) {
    const filter = table === 'caption_runs' ? 'id' : 'run_id';
    const rows = [];
    let total = null;
    // Bounded pagination. A capped observation is explicitly incomplete.
    for (let start = 0; start < 10000; start += 500) {
      const query = new URLSearchParams({ select: columns, [filter]: `eq.${runId}`, limit: '500', offset: String(start) });
      // Stable order prevents duplicates when rows exceed one page.
      query.set('order', table === 'caption_source_segments' ? 'segment_order.asc'
        : table === 'caption_captions' ? 'segment_id.asc,language.asc'
        : table === 'caption_uplink_tickets' ? 'created_at.asc,id.asc'
        : table === 'caption_runs' ? 'id.asc' : 'id.asc');
      const response = await request(`${config.origin}/rest/v1/${table}?${query}`, headers);
      let page;
      try { page = await response.json(); }
      catch { throw new Error('Invalid observation JSON; response body omitted'); }
      if (!Array.isArray(page)) throw new Error('Unexpected observation response');
      rows.push(...page);
      const count = response.headers.get('content-range')?.split('/')[1];
      if (count && /^\d+$/.test(count)) total = Number(count);
      if (page.length < 500 || (total !== null && rows.length >= total)) break;
    }
    data[table] = { rows, total, incomplete: total === null || total !== rows.length };
  }
  if (data.caption_runs.rows.length !== 1) throw new Error('Run not found');
  return summarize(data);
}

function summarize(data) {
  const sources = data.caption_source_segments.rows;
  const captions = data.caption_captions.rows;
  const countBy = (rows, key) => rows.reduce((out, row) => {
    const value = String(row[key]); out[value] = (out[value] || 0) + 1; return out;
  }, Object.create(null));
  const run = data.caption_runs.rows[0];
  return {
    observedAt: new Date().toISOString(),
    // Construct the report explicitly: never spread remote records into output.
    run: { id: run.id, state: run.state, generation: run.mode_generation, epoch: run.channel_epoch,
      fence: run.fencing_token, startedAt: run.started_at, endedAt: run.ended_at },
    incompleteTables: Object.entries(data).filter(([, value]) => value.incomplete).map(([name]) => name),
    sourceStates: countBy(sources, 'status'),
    languages: Object.fromEntries(['en', 'ja', 'zh-CN'].map(language => [language, {
      states: countBy(captions.filter(row => row.language === language), 'status'),
      finalSourcesWithoutCurrentFinal: sources.filter(source => ['final', 'corrected'].includes(source.status) && !captions.some(caption =>
        caption.segment_id === source.segment_id && caption.language === language
        && ['final', 'corrected'].includes(caption.status) && caption.source_revision === source.source_revision)).length
    }])),
    outboxStates: countBy(data.caption_outbox_events.rows, 'status'),
    usedUplinkTimes: data.caption_uplink_tickets.rows.map(row => row.used_at).filter(Boolean),
    operationalTypes: countBy(data.caption_operational_events.rows, 'type'),
    limitation: 'Read-only samples are not a transaction. Multiple used tickets indicate connections, not gap-free handoff or translation quality. Compare guest playback and operator notices.'
  };
}

async function main() {
  const [preview, runId] = process.argv.slice(2);
  const root = path.resolve(__dirname, '..');
  const report = await observe({ config: readConfig(root), preview, runId });
  const directory = path.join(root, 'private', 'observations');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `${Date.now()}-${runId}.json`);
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Saved private observation: ${filename}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readConfig, observe, summarize, TABLES };
