// Explicit public asset list: never publish server modules, SQL, tests or secrets.
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const pages = [
  'wedding-invitation.html', 'admin.html', 'seating-planner.html',
  'whatsapp-outreach.html', 'preview.html', 'wedding-day.html',
  'wedding-day.js', 'wedding-day-now.js', 'wedding-day-data.js',
  'live-captions.html', 'live-captions-admin.html', 'live-captions.css',
  'live-captions-preview.js', 'live-captions-admin.js', 'live-captions-guest.js',
  'live-captions-client.js', 'live-captions-audio.js', 'live-captions-worklet.js'
];
async function main() {
  const output = path.join(root, 'dist');
  // Do not clean arbitrary paths. Fail closed if stale output contains private files.
  await fs.mkdir(output, { recursive: true });
  await build({ stdin: { contents: 'import * as sdk from "@supabase/supabase-js"; window.supabase = sdk;',
    resolveDir: root }, bundle: true, platform: 'browser', format: 'iife',
    target: ['chrome120', 'safari17'], minify: true, sourcemap: false,
    outfile: path.join(root, 'vendor', 'supabase.js'), legalComments: 'eof' });
  // The operator page draws the guest-link QR code locally; the link never leaves the browser.
  await build({ stdin: { contents: 'import qrcode from "qrcode-generator"; window.qrcode = qrcode;',
    resolveDir: root }, bundle: true, platform: 'browser', format: 'iife',
    target: ['chrome120', 'safari17'], minify: true, sourcemap: false,
    outfile: path.join(root, 'vendor', 'qr.js'), legalComments: 'eof' });
  for (const name of pages) await fs.copyFile(path.join(root, name), path.join(output, name));
  await fs.cp(path.join(root, 'photos'), path.join(output, 'photos'), { recursive: true });
  await fs.mkdir(path.join(output, 'vendor'), { recursive: true });
  for (const name of ['supabase.js', 'qr.js']) await fs.copyFile(path.join(root, 'vendor', name), path.join(output, 'vendor', name));
  const allowed = new Set([...pages, 'photos', 'vendor']);
  for (const name of await fs.readdir(output)) {
    if (!allowed.has(name)) throw new Error(`Unexpected build output: ${name}. Inspect before deployment.`);
  }
  console.log('Built public site assets; SQL, private data and server modules excluded.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
