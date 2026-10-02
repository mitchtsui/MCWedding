'use strict';

const crypto = require('node:crypto');

// Guests read captions without a Supabase account, so their Broadcast topic is public. The topic name is
// unguessable without the server key, and every message on it carries an ECDSA P-256 signature the
// browser checks with the public key it receives from guestSnapshot.
function createGuestSigner(env = process.env) {
  const encoded = typeof env?.CAPTIONS_GUEST_SIGNING_KEY === 'string' ? env.CAPTIONS_GUEST_SIGNING_KEY.trim() : '';
  if (!encoded) return null;
  let der, key, publicJwk;
  try {
    der = Buffer.from(encoded, 'base64');
    key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const { kty, crv, x, y } = crypto.createPublicKey(key).export({ format: 'jwk' });
    if (kty !== 'EC' || crv !== 'P-256') return null;
    publicJwk = { kty, crv, x, y };
  } catch { return null; }
  return {
    publicJwk,
    topicFor(eventId, language) {
      const h = crypto.createHmac('sha256', der).update(`caption-guest-topic:${eventId}`).digest('hex').slice(0, 32);
      return `caption-guest:${eventId}:${language}:${h}`;
    },
    envelope(payload) {
      const data = JSON.stringify(payload);
      const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return { data, sig };
    },
  };
}

function guestLinksReady(env = process.env) {
  return env?.CAPTIONS_GUEST_LINKS === 'true' && createGuestSigner(env) !== null;
}

module.exports = { createGuestSigner, guestLinksReady };
