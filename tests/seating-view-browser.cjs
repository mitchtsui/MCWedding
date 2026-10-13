'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const assets = new Map([
  ['/', ['seating-view.html', 'text/html; charset=utf-8']],
  ['/seating-view.css', ['seating-view.css', 'text/css; charset=utf-8']],
  ['/seating-view.js', ['seating-view.js', 'application/javascript; charset=utf-8']]
]);

function runChrome(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`Chrome exited ${code}: ${stderr}`)));
  });
}

async function main() {
  let apiMethod;
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/seating-view')) {
      apiMethod = req.method;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, guests: [
        { name: 'Alex Chan', table_number: 1 },
        { name: 'Alex Chan', table_number: 1 },
        { name: 'Taylor Lee', table_number: 15 }
      ] }));
      return;
    }
    const url = new URL(req.url, 'http://local.test');
    const asset = assets.get(url.pathname);
    if (!asset) { res.statusCode = 404; res.end('Not found'); return; }
    res.setHeader('Content-Type', asset[1]);
    res.end(await fs.readFile(path.join(root, asset[0])));
  });

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'mcwedding-seating-view-'));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const dom = await runChrome([
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      `--user-data-dir=${profile}`,
      '--window-size=344,900',
      '--virtual-time-budget=1500',
      '--dump-dom',
      `http://127.0.0.1:${port}/?hub=1`
    ]);

    assert.equal(apiMethod, 'GET');
    assert.match(dom, /<body class="hub-mode">/);
    assert.equal((dom.match(/class="table-button/g) || []).length, 13);
    assert.equal((dom.match(/Alex Chan/g) || []).length, 2);
    assert.match(dom, /aria-label="Table 15, 1 guest"/);
    assert.doesNotMatch(dom, /seat_number|invitation_code|phone|magic-link|admin-nav/i);
    console.log('Seating view browser smoke passed at 344px with mocked API data.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
