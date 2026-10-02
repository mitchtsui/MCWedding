'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGuestSigner, guestLinksReady } = require('../lib/captions/guest-link.cjs');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function signingKey(options = { namedCurve: 'P-256' }, type = 'ec') {
  return crypto.generateKeyPairSync(type, options).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

async function verifies(publicJwk, { data, sig }) {
  const key = await crypto.webcrypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(data));
}

test('guest envelopes sign the topic, the signing time and the payload, and verify with WebCrypto', async () => {
  const signer = createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: signingKey() });
  assert.deepEqual(Object.keys(signer.publicJwk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal(signer.publicJwk.kty, 'EC'); assert.equal(signer.publicJwk.crv, 'P-256');
  const topic = signer.topicFor(EVENT_ID, 'ja');
  const payload = { type: 'caption.batch', eventId: EVENT_ID, language: 'ja', updates: [{ text: '本日はありがとうございます。' }] };
  const before = Date.now(), envelope = signer.envelope(topic, payload), after = Date.now();
  assert.deepEqual(Object.keys(envelope), ['data', 'sig']);
  const signed = JSON.parse(envelope.data);
  assert.deepEqual(Object.keys(signed), ['topic', 'iat', 'payload']);
  assert.equal(signed.topic, topic); assert.deepEqual(signed.payload, payload);
  assert(Number.isInteger(signed.iat) && signed.iat >= before && signed.iat <= after, 'iat is the server time in integer ms');
  assert.match(envelope.sig, /^[A-Za-z0-9_-]{86}$/, 'base64url without padding');
  assert.equal(Buffer.from(envelope.sig, 'base64url').length, 64, 'IEEE P1363 r||s');
  assert.equal(await verifies(signer.publicJwk, envelope), true);
  assert.equal(await verifies(signer.publicJwk, { ...envelope, data: envelope.data.replace('ja', 'en') }), false);
  const moved = JSON.stringify({ ...signed, topic: signer.topicFor(EVENT_ID, 'en') });
  assert.equal(await verifies(signer.publicJwk, { ...envelope, data: moved }), false, 'a message cannot be replayed under another topic');
  const other = createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: signingKey() });
  assert.equal(await verifies(other.publicJwk, envelope), false, 'another key cannot vouch for this message');
});

test('the guest topic hashes event and language with a key derived from, not equal to, the signing key', () => {
  const encoded = signingKey(), der = Buffer.from(encoded, 'base64'), signer = createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: encoded });
  const topicKey = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('caption-guest-topic:'), der])).digest();
  const hash = (eventId, language) => crypto.createHmac('sha256', topicKey).update(`${eventId}:${language}`).digest('hex').slice(0, 32);
  const topic = signer.topicFor(EVENT_ID, 'en');
  assert.equal(topic, `caption-guest:${EVENT_ID}:en:${hash(EVENT_ID, 'en')}`);
  assert.equal(signer.topicFor(EVENT_ID, 'ja'), `caption-guest:${EVENT_ID}:ja:${hash(EVENT_ID, 'ja')}`);
  assert.notEqual(hash(EVENT_ID, 'ja'), hash(EVENT_ID, 'en'), 'each language has its own hash');
  assert.notEqual(topic.split(':').at(-1), crypto.createHmac('sha256', der).update(`${EVENT_ID}:en`).digest('hex').slice(0, 32),
    'the signing key itself is not the HMAC key');
  assert.notEqual(signer.topicFor('22222222-2222-4222-8222-222222222222', 'en').split(':').at(-1), hash(EVENT_ID, 'en'));
  assert.notEqual(createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: signingKey() }).topicFor(EVENT_ID, 'en'), topic, 'a new key moves the topic');
});

test('a signing key is parsed once and the same signer is reused for it', () => {
  const encoded = signingKey();
  const first = createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: encoded });
  assert.equal(createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: ` ${encoded}\n` }), first);
  assert.notEqual(createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: signingKey() }), first);
  assert.equal(Object.isFrozen(first) && Object.isFrozen(first.publicJwk), true, 'the shared signer cannot be altered by a caller');
});

test('missing or unusable signing keys disable guest links without throwing', () => {
  const key = signingKey();
  for (const value of [undefined, '', '   ', 'not base64 at all', Buffer.from('short').toString('base64'),
    signingKey({ namedCurve: 'P-384' }), signingKey({ modulusLength: 1024 }, 'rsa'), signingKey(undefined, 'ed25519'),
    crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]) {
    assert.equal(createGuestSigner({ CAPTIONS_GUEST_SIGNING_KEY: value }), null, String(value).slice(0, 20));
    assert.equal(guestLinksReady({ CAPTIONS_GUEST_LINKS: 'true', CAPTIONS_GUEST_SIGNING_KEY: value }), false);
  }
  assert.equal(createGuestSigner({}), null);
  assert.equal(guestLinksReady({ CAPTIONS_GUEST_LINKS: 'true', CAPTIONS_GUEST_SIGNING_KEY: key }), true);
  for (const flag of [undefined, 'false', 'TRUE', '1']) assert.equal(guestLinksReady({ CAPTIONS_GUEST_LINKS: flag, CAPTIONS_GUEST_SIGNING_KEY: key }), false);
});
