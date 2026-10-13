/* Browser acceptance for the local captions preview; no production requests. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const http = require('node:http');

async function main() {
  // Existing workspace tooling, not a production application dependency.
  const modulePath = process.env.PUPPETEER_MODULE || path.resolve(__dirname, '../../Personal - wset-atlas/node_modules/puppeteer');
  const puppeteer = require(modulePath);
  const root = path.resolve(__dirname, '..');
  const output = process.env.CAPTIONS_SCREENSHOT_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'captions-ui-'));
  await fs.mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true,
    executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-first-run'], });
  const watchdog = setTimeout(() => { console.error('Browser check exceeded 90 seconds'); browser.process()?.kill(); }, 90000);
  const errors = [], requests = [], measurements = [];
  const allowed = new Set(['admin.html', 'live-captions.html', 'live-captions-admin.html', 'live-captions.css',
    'live-captions-preview.js', 'live-captions-guest.js', 'live-captions-admin.js']);
  const server = http.createServer(async (req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!allowed.has(file)) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' :
        file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      res.end(await fs.readFile(path.join(root, file)));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = (file, preview = true) => `http://127.0.0.1:${server.address().port}/${file}` + (preview ? '?preview=1' : '');
  async function page() {
    const p = await browser.newPage();
    p.setDefaultTimeout(8000);
    p.setDefaultNavigationTimeout(15000);
    p.on('pageerror', error => errors.push(error.message));
    p.on('request', r => {
      requests.push(r.url());
      assert(!/supabase|api\.openai|\/api\/config/.test(r.url()), 'preview must not access live services');
    });
    return p;
  }
  try {
    for (const width of [344, 390, 744, 1280]) {
      for (const file of ['live-captions.html', 'live-captions-admin.html']) {
        console.log('Layout', file, width);
        const p = await page();
        await p.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        await p.goto(url(file), { waitUntil: 'networkidle0' });
        await p.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]));
        const m = await p.evaluate(() => {
          const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
          const small = [...document.querySelectorAll('p,span,label,button,a,strong,h1,h2,dt,dd')]
            .filter(e => visible(e) && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11.19)
            .map(e => e.id || e.className);
          const targets = [...document.querySelectorAll('button,a')].filter(visible)
            .filter(e => e.getBoundingClientRect().height < 43.9).map(e => e.id || e.textContent.trim());
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, small, targets };
        });
        assert(m.scrollWidth <= width + 1, `${file} overflow at ${width}: ${m.scrollWidth}`);
        assert.deepEqual(m.small, [], `${file} small text at ${width}`);
        assert.deepEqual(m.targets, [], `${file} small targets at ${width}`);
        measurements.push({ file, ...m });
        if (width === 390 || width === 1280) {
          await p.screenshot({ path: path.join(output, file.replace('.html', '') + '-' + width + '.png'), fullPage: true });
        }
        await p.close();
      }
    }
    const operator = await page(), guest = await page();
    console.log('Interaction checks');
    await operator.goto(url('live-captions-admin.html'), { waitUntil: 'networkidle0' });
    await guest.goto(url('live-captions.html'), { waitUntil: 'networkidle0' });
    await guest.bringToFront();
    await guest.click('[data-language="ja"]');
    assert.equal(await guest.evaluate(() => document.documentElement.lang), 'ja');
    await guest.click('[data-language="zh-CN"]');
    assert.equal(await guest.evaluate(() => document.documentElement.lang), 'zh-CN');
    await guest.click('[data-language="en"]');
    console.log('Language switching passed');
    const before = await guest.$eval('#latestText', e => parseFloat(getComputedStyle(e).fontSize));
    console.log('Checking font size');
    await guest.click('#increaseText');
    assert((await guest.$eval('#latestText', e => parseFloat(getComputedStyle(e).fontSize))) > before);
    console.log('Checking operator playback');
    await operator.bringToFront();
    await operator.click('#start-button');
    await operator.waitForFunction(() => window.CaptionsPreview.getSnapshot().status === 'playing');
    await operator.click('#pause-button');
    await operator.waitForFunction(() => window.CaptionsPreview.getSnapshot().status === 'paused');
    await operator.click('#next-button');
    await guest.bringToFront();
    console.log('Waiting for same-browser sample delivery');
    await guest.waitForFunction(() => window.CaptionsPreview.getSnapshot().segments.length === 4);
    const unsafe = '<img src=x onerror="window.captionXss=true">';
    await operator.bringToFront();
    await operator.type('#manual-en', unsafe);
    await operator.click('#manual-submit');
    await guest.bringToFront();
    console.log('Waiting for manual sample delivery');
    await guest.waitForFunction(text => document.getElementById('latestText').textContent === text, {}, unsafe);
    assert.equal(await guest.evaluate(() => !!window.captionXss), false);
    assert.equal(await guest.$eval('#latestText', e => e.children.length), 0);
    await guest.click('[data-language="ja"]');
    assert(!(await guest.$eval('#latestText', e => e.textContent)).includes('<img'), 'blank locale must not inherit English');
    await operator.bringToFront();
    await operator.click('#resume-button');
    await operator.click('#stop-button');
    await operator.waitForFunction(() => window.CaptionsPreview.getSnapshot().status === 'paused');
    await operator.click('#end-button');
    await operator.waitForFunction(() => window.CaptionsPreview.getSnapshot().status === 'ended');
    console.log('Checking reading position and browser Back restoration');
    await guest.bringToFront();
    await guest.setViewport({ width: 390, height: 900 });
    await guest.click('[data-language="en"]');
    await guest.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo(0, 0);
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    const originalTop = await guest.$eval('#latestCaption', e => e.getBoundingClientRect().top);
    for (let i = 0; i < 3; i++) {
      await operator.evaluate(n => window.CaptionsPreview.sendManual({ en: 'New sample ' + n, ja: '', 'zh-CN': '' }), i);
      await guest.waitForFunction(n => document.getElementById('latestText').textContent === 'New sample ' + n, {}, i);
      await new Promise(resolve => setTimeout(resolve, 100));
      const currentTop = await guest.$eval('#latestCaption', e => e.getBoundingClientRect().top);
      assert(Math.abs(currentTop - originalTop) < 3,
        `following latest moved from ${originalTop} to ${currentTop} on update ${i}`);
    }
    for (let i = 0; i < 8; i++) {
      await operator.evaluate(n => window.CaptionsPreview.sendManual({
        en: `History ${n}. ` + 'A longer sample to check a comfortable reading position. '.repeat(4), ja: '', 'zh-CN': '' }), i);
    }
    await guest.waitForFunction(() => document.getElementById('latestText').textContent.startsWith('History 7.'));
    const anchor = await guest.evaluate(() => {
      const card = document.querySelectorAll('#historyList [data-segment-id]')[3];
      card.scrollIntoView({ block: 'start', behavior: 'instant' });
      window.scrollBy({ top: -60, behavior: 'instant' });
      return { id: card.dataset.segmentId, top: card.getBoundingClientRect().top };
    });
    await operator.evaluate(() => window.CaptionsPreview.sendManual({ en: 'Newest history test caption', ja: '', 'zh-CN': '' }));
    await guest.waitForFunction(() => document.getElementById('latestText').textContent === 'Newest history test caption');
    await guest.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const anchorAfter = await guest.evaluate(id => [...document.querySelectorAll('#historyList [data-segment-id]')]
      .find(e => e.dataset.segmentId === id).getBoundingClientRect().top, anchor.id);
    assert(Math.abs(anchorAfter - anchor.top) < 3, 'deep history reading position preserved');
    assert.equal(await guest.$eval('#followLatest', e => e.hidden), false);
    await guest.evaluate(() => {
      window.addEventListener('pageshow', event => { window.wasRestored = event.persisted; });
    });
    await guest.goto(url('admin.html', false), { waitUntil: 'networkidle0' });
    await guest.goBack({ waitUntil: 'domcontentloaded' });
    assert.equal(await guest.evaluate(() => window.wasRestored), true, 'actual BFCache restoration exercised');
    await operator.evaluate(() => window.CaptionsPreview.sendManual({ en: 'Back navigation sample', ja: '', 'zh-CN': '' }));
    await guest.waitForFunction(() => document.getElementById('latestText').textContent === 'Back navigation sample');
    await operator.close(); await guest.close();
    const plain = await page();
    await plain.goto(url('live-captions.html', false), { waitUntil: 'networkidle0' });
    assert.equal(await plain.evaluate(() => window.CaptionsPreview.getSnapshot().segments.length), 0);
    assert.equal(await plain.$eval('#previewBanner', e => e.hidden), true);
    await plain.goto(url('live-captions-admin.html', false), { waitUntil: 'networkidle0' });
    assert.equal(await plain.$eval('#start-button', e => e.disabled), true);
    assert.equal(await plain.evaluate(() => window.CaptionsPreview.start()), false);
    await plain.goto(url('admin.html', false), { waitUntil: 'networkidle0' });
    assert(await plain.$('a[href="live-captions-admin.html?live=1"]'), 'gated live admin entry exists');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', measurements, browser: await browser.version(), screenshotDirectory: output,
      checks: ['language', 'text sizing', 'preview controls', 'same-browser delivery', 'manual text escaping',
        'missing language', 'stable latest reading position', 'deep history reading position', 'real BFCache restoration', 'default waiting',
        'disabled live actions', 'admin entry', 'no live service requests', 'zero page errors'] }, null, 2));
  } finally {
    clearTimeout(watchdog);
    const cleanup = setTimeout(() => browser.process()?.kill(), 5000);
    await browser.close(); clearTimeout(cleanup);
    server.closeAllConnections(); server.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
