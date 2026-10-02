'use strict';

const crypto = require('node:crypto');

const signers = new Map();

// Guests read captions without a Supabase account, so their Broadcast topic is public. The topic name is
// unguessable without the server key, and every message on it carries an ECDSA P-256 signature over the
// topic, the signing time and the payload, which the browser checks with the key from guestSnapshot.
function createGuestSigner(env = process.env) {
  const encoded = typeof env?.CAPTIONS_GUEST_SIGNING_KEY === 'string' ? env.CAPTIONS_GUEST_SIGNING_KEY.trim() : '';
  if (!encoded) return null;
  // Parsed once per key string: one process only ever sees the deployment's key (tests, a few more).
  if (!signers.has(encoded)) {
    if (signers.size >= 8) signers.clear();
    signers.set(encoded, parseSigner(encoded));
  }
  return signers.get(encoded);
}

function parseSigner(encoded) {
  let key, topicKey, publicJwk;
  try {
    const der = Buffer.from(encoded, 'base64');
    key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const { kty, crv, x, y } = crypto.createPublicKey(key).export({ format: 'jwk' });
    if (kty !== 'EC' || crv !== 'P-256') return null;
    publicJwk = Object.freeze({ kty, crv, x, y });
    // The topic HMAC key is derived from the signing key rather than being the signing key itself.
    topicKey = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('caption-guest-topic:'), der])).digest();
  } catch { return null; }
  return Object.freeze({
    publicJwk,
    topicFor(eventId, language) {
      const h = crypto.createHmac('sha256', topicKey).update(`${eventId}:${language}`).digest('hex').slice(0, 32);
      return `caption-guest:${eventId}:${language}:${h}`;
    },
    envelope(topic, payload) {
      const data = JSON.stringify({ topic, iat: Date.now(), payload });
      const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return { data, sig };
    },
  });
}

function guestLinksReady(env = process.env) {
  return env?.CAPTIONS_GUEST_LINKS === 'true' && createGuestSigner(env) !== null;
}

module.exports = { createGuestSigner, guestLinksReady };
