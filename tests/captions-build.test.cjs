const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('Vercel publishes only the explicit public build, never repository source', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'npm run build');
  const build = fs.readFileSync(path.join(root, 'scripts/build-site.cjs'), 'utf8');
  assert.match(build, /Unexpected build output/);
  const excluded = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');
  for (const value of ['private/', 'supabase/', '.env', 'tests/']) assert.ok(excluded.includes(value));
});

test('built site has no private files or server modules', { skip: !fs.existsSync(path.join(root, 'dist')) }, () => {
  function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.ok(!/^(?:api|lib|private|supabase|tests|node_modules|\.env.*)$/.test(entry.name), entry.name);
      assert.ok(!/\.(?:sql|env|cjs|mjs|map)$/.test(entry.name), entry.name);
      if (entry.isDirectory()) check(path.join(directory, entry.name));
    }
  }
  check(path.join(root, 'dist'));
  for (const file of ['wedding-invitation.html', 'live-captions-admin.html', 'live-captions.html', 'vendor/supabase.js']) {
    assert.ok(fs.statSync(path.join(root, 'dist', file)).size > 0, file);
  }
});
