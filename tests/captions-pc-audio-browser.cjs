/* Real browser AudioContext/worklet; synthetic shared audio/video, no provider or native picker. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

async function main() {
  const puppeteer = require(process.env.PUPPETEER_MODULE || path.resolve(__dirname, '../../Personal - wset-atlas/node_modules/puppeteer'));
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<button id="share">Share</button><script src="/live-captions-audio.js"></script>'); return;
    }
    if (!['/live-captions-audio.js', '/live-captions-worklet.js'].includes(req.url)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, req.url.slice(1))));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      window.testState = { frames: 0, bytes: 0, peak: 0, ended: 0, microphoneCalls: 0 };
      const mediaDevices = {
        getUserMedia() { testState.microphoneCalls++; throw new Error('Unexpected microphone fallback'); },
        async getDisplayMedia(options) {
          testState.gesture = navigator.userActivation.isActive; testState.options = options;
          const context = new AudioContext(), tone = context.createOscillator(), destination = context.createMediaStreamDestination();
          tone.frequency.value = 440; tone.connect(destination); tone.start(); await context.resume();
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
          canvas.getContext('2d').fillRect(0, 0, 2, 2);
          window.sharedTracks = [...destination.stream.getAudioTracks(), ...canvas.captureStream(1).getVideoTracks()];
          window.toneContext = context;
          return new MediaStream(sharedTracks);
        }
      };
      window.capture = new CaptionsAudio.Capture({ mediaDevices,
        onFrame(buffer, samples) { testState.frames++; testState.bytes = buffer.byteLength; testState.samples = samples;
          for (const value of new Int16Array(buffer)) testState.peak = Math.max(testState.peak, Math.abs(value)); },
        onDeviceEnded() { testState.ended++; }
      });
      document.getElementById('share').onclick = () => { window.sharePromise = capture.prepareDisplay(); };
    });
    await page.click('#share'); await page.evaluate(() => window.sharePromise);
    assert.equal(await page.evaluate(() => testState.gesture), true, 'picker requested during click activation');
    assert.equal(await page.evaluate(() => testState.frames), 0, 'preparing shares no PCM');
    await page.evaluate(() => capture.start('pc'));
    await page.waitForFunction(() => testState.frames >= 3);
    const state = await page.evaluate(() => testState);
    assert.equal(state.bytes, 2400); assert.equal(state.samples, 1200); assert(state.peak > 1000);
    assert.equal(state.microphoneCalls, 0); assert.equal(state.options.audio, true); assert.equal(state.options.video, true);
    await page.evaluate(() => { sharedTracks.find(track => track.kind === 'video').dispatchEvent(new Event('ended')); });
    await page.waitForFunction(() => !capture.active());
    assert.deepEqual(await page.evaluate(() => sharedTracks.map(track => track.readyState)), ['ended', 'ended']);
    assert.equal(await page.evaluate(() => testState.ended), 1);
    await page.evaluate(() => toneContext.close());
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', browser: await browser.version(), checks: ['click activation', 'no frames before Start', 'shared synthetic tone through real worklet', '24kHz PCM frame size', 'no microphone fallback', 'video-ended stops all tracks'], limitation: 'Native share picker and actual YouTube/WhatsApp playback are not exercised.' }));
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
