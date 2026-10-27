// Signing and verification for entry-pass identifiers.
//
// The QR code carries   <passId>.<version>.<signature>
// so that a valid code cannot be produced by guessing or editing a pass ID,
// and re-issuing a pass (version + 1) invalidates the old QR.
//
// The pass download link on the success page carries an expiry and a
// signature, so it cannot be built from a pass ID.
const crypto = require('crypto');
const { env } = require('../config/env');

// Crockford-style alphabet without look-alike characters (0/O, 1/I/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PASS_ID_RE = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

function generatePassId() {
  let s = '';
  for (let i = 0; i < 12; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function isValidPassIdFormat(passId) {
  return typeof passId === 'string' && PASS_ID_RE.test(passId);
}

function sign(purpose, ...parts) {
  return crypto
    .createHmac('sha256', env.passSecret)
    .update([purpose, ...parts].join(':'))
    .digest('base64url')
    .slice(0, 32);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function qrPayload(passId, version) {
  return `${passId}.${version}.${sign('qr', passId, version)}`;
}

/**
 * Parses and checks the signature of a scanned QR value (or a typed pass ID).
 * Returns { passId, version, signed } or null when the value is malformed or
 * the signature is wrong. A bare pass ID returns signed: false; callers decide
 * whether that is acceptable (manual entry by gate staff).
 */
function parseQrPayload(value) {
  const text = String(value || '').trim().toUpperCase();
  if (isValidPassIdFormat(text)) return { passId: text, version: null, signed: false };

  // Signature is base64url and case-sensitive, so split the original value.
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 3) return null;
  const [passId, versionStr, sig] = parts;
  const version = Number(versionStr);
  if (!isValidPassIdFormat(passId) || !Number.isInteger(version) || version < 1) return null;
  if (!safeEqual(sig, sign('qr', passId, version))) return null;
  return { passId, version, signed: true };
}

function imageLinkQuery(passId, version, now = Date.now()) {
  const exp = Math.floor(now / 1000) + env.passImageLinkMinutes * 60;
  return { v: version, exp, sig: sign('img', passId, version, exp) };
}

function verifyImageLink(passId, { v, exp, sig }, now = Date.now()) {
  const version = Number(v);
  const expiry = Number(exp);
  if (!isValidPassIdFormat(passId) || !Number.isInteger(version) || !Number.isInteger(expiry)) return null;
  if (expiry < Math.floor(now / 1000)) return null;
  if (!safeEqual(sig, sign('img', passId, version, expiry))) return null;
  return { version };
}

module.exports = {
  generatePassId,
  isValidPassIdFormat,
  qrPayload,
  parseQrPayload,
  imageLinkQuery,
  verifyImageLink,
};
