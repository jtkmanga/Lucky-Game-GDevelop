'use strict';

/**
 * Server-side Firebase Authentication ID token verifier.
 * This module is intentionally not wired to the legacy ZIP server yet.
 * The caller MUST verify the token before accepting a WebSocket join.
 * No network calls at import-time; Google public certs are fetched on demand.
 */
const { createPublicKey, verify: verifySignature } = require('node:crypto');

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const ISSUER_PREFIX = 'https://securetoken.google.com/';
const MAX_TOKEN_LENGTH = 16384;
let certCache = { expiresAt: 0, certificates: null };

function unauthorized() {
  const e = new Error('Unauthenticated');
  e.code = 'UNAUTHENTICATED';
  return e;
}

function base64urlJSON(value) {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unauthorized();
    return parsed;
  } catch {
    throw unauthorized();
  }
}

async function publicCertificates() {
  if (certCache.certificates && Date.now() < certCache.expiresAt) return certCache.certificates;
  const response = await fetch(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Firebase certificate service unavailable');
  const certificates = await response.json();
  if (!certificates || typeof certificates !== 'object' || Array.isArray(certificates)) {
    throw new Error('Invalid Firebase certificate response');
  }
  const cacheControl = response.headers.get('cache-control') || '';
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  const seconds = match ? Math.min(Number(match[1]), 3600) : 300;
  certCache = { certificates, expiresAt: Date.now() + Math.max(30, seconds) * 1000 };
  return certificates;
}

/**
 * @param {string} idToken Firebase ID token returned by Firebase Auth client SDK
 * @param {{projectId: string}} config Trusted project ID from server environment
 * @returns {Promise<{uid:string,email:string|null,emailVerified:boolean,authTime:number,claims:object}>}
 */
async function verifyFirebaseIdToken(idToken, { projectId } = {}) {
  if (typeof projectId !== 'string' || !/^[a-z0-9][a-z0-9-]{4,62}$/i.test(projectId)) {
    throw new Error('FIREBASE_PROJECT_ID must be configured on the server');
  }
  if (typeof idToken !== 'string' || idToken.length < 30 || idToken.length > MAX_TOKEN_LENGTH) {
    throw unauthorized();
  }
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw unauthorized();

  const header = base64urlJSON(parts[0]);
  const claims = base64urlJSON(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw unauthorized();
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== ISSUER_PREFIX + projectId ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
      !Number.isInteger(claims.iat) || claims.iat > now ||
      !Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.auth_time) || claims.auth_time > now) {
    throw unauthorized();
  }

  const certificates = await publicCertificates();
  const certificate = certificates[header.kid];
  if (typeof certificate !== 'string') throw unauthorized();
  let valid = false;
  try {
    valid = verifySignature(
      'RSA-SHA256',
      Buffer.from(parts[0] + '.' + parts[1], 'utf8'),
      createPublicKey(certificate),
      Buffer.from(parts[2], 'base64url')
    );
  } catch {
    throw unauthorized();
  }
  if (!valid) throw unauthorized();

  return {
    uid: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    emailVerified: claims.email_verified === true,
    authTime: claims.auth_time,
    claims
  };
}

/**
 * Require identity for online matchmaking. No guest bypass in this module.
 * VIP access must additionally be checked with server-owned entitlement storage.
 */
async function requirePlayerIdentity(joinRequest, config) {
  if (!joinRequest || typeof joinRequest.idToken !== 'string') throw unauthorized();
  return verifyFirebaseIdToken(joinRequest.idToken, config);
}

module.exports = { verifyFirebaseIdToken, requirePlayerIdentity };
