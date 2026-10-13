'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHandler } = require('../api/vip-assets.js');
const { createHubAuth } = require('../lib/hub-auth.cjs');

const ENV = {
  WEDDING_HUB_PASSWORD: 'door',
  WEDDING_HUB_SESSION_SECRET: 'synthetic-vip-test-secret-0123456789abcdef'
};
const PRIVATE_MARKER = 'synthetic-private-field-must-not-leak';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

let root;
let handler;
let cookie;

test.before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-vip-assets-'));
  await fs.mkdir(path.join(root, 'hub-private'), { recursive: true });
  await fs.mkdir(path.join(root, 'photos', 'vip'), { recursive: true });
  await fs.writeFile(path.join(root, 'hub-private', 'vip-data.json'), JSON.stringify({
    people: [{
      id: 'synthetic-one',
      name: 'Synthetic Person',
      relationship: 'Test relation',
      family: 'christy',
      phone: PRIVATE_MARKER,
      notes: PRIVATE_MARKER,
      photo: PRIVATE_MARKER
    }],
    rows: [{
      family: 'christy',
      ids: ['synthetic-one'],
      breakBefore: true,
      privateNote: PRIVATE_MARKER
    }],
    privateMetadata: PRIVATE_MARKER
  }));
  await fs.writeFile(path.join(root, 'photos', 'vip', 'synthetic-one.jpg'), JPEG_BYTES);
  handler = createHandler({ env: ENV, root });
  const signed = createHubAuth({ env: ENV }).login({ headers: {} }, ENV.WEDDING_HUB_PASSWORD);
  cookie = signed.cookie.split(';', 1)[0];
});

test.after(async () => {
  const resolvedRoot = path.resolve(root);
  const resolvedTemp = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolvedRoot.startsWith(resolvedTemp));
  assert.match(path.basename(resolvedRoot), /^mcw-vip-assets-/);
  await fs.rm(resolvedRoot, { recursive: true, force: true });
});

function request({ method = 'GET', url = '/api/vip-assets.js?asset=data', authenticated = true } = {}) {
  return { method, url, headers: authenticated ? { cookie } : {} };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = body; }
  };
}

async function call(options) {
  const res = response();
  await handler(request(options), res);
  return res;
}

function assertPrivateResponseHeaders(res) {
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
}

test('unauthenticated JSON and JPEG requests disclose no private content', async () => {
  for (const url of [
    '/api/vip-assets.js?asset=data',
    '/api/vip-assets.js?asset=synthetic-one.jpg'
  ]) {
    const res = await call({ url, authenticated: false });
    assert.equal(res.statusCode, 401);
    assertPrivateResponseHeaders(res);
    assert.doesNotMatch(String(res.body), /Synthetic Person|synthetic-one|synthetic-private/i);
  }
});

test('only GET is allowed before any private asset is returned', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await call({ method });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
    assertPrivateResponseHeaders(res);
    assert.equal(res.body, '');
  }
});

test('asset names reject traversal, alternate extensions, and unlisted resources', async () => {
  for (const asset of [
    '../hub-private/vip-data.json',
    '..\\hub-private\\vip-data.json',
    'synthetic-one.jpeg',
    'vip-data.json',
    '/etc/passwd'
  ]) {
    const url = '/api/vip-assets.js?asset=' + encodeURIComponent(asset);
    const res = await call({ url });
    assert.equal(res.statusCode, 404, asset);
    assertPrivateResponseHeaders(res);
    assert.doesNotMatch(String(res.body), /Synthetic Person|synthetic-private/i);
  }
});

test('authenticated JSON response exposes only the directory contract fields', async () => {
  const res = await call({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assertPrivateResponseHeaders(res);
  assert.deepEqual(JSON.parse(res.body), {
    people: [{
      id: 'synthetic-one',
      name: 'Synthetic Person',
      relationship: 'Test relation',
      family: 'christy',
      photo: '/api/vip-assets.js?asset=synthetic-one.jpg'
    }],
    rows: [{ family: 'christy', ids: ['synthetic-one'], breakBefore: true }]
  });
  assert.doesNotMatch(res.body, /phone|notes|privateMetadata|privateNote|synthetic-private/i);
});

test('authenticated JPEG response preserves bytes and private no-store headers', async () => {
  const res = await call({ url: '/api/vip-assets.js?asset=synthetic-one.jpg' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assertPrivateResponseHeaders(res);
  assert.ok(Buffer.isBuffer(res.body));
  assert.deepEqual(res.body, JPEG_BYTES);
});
