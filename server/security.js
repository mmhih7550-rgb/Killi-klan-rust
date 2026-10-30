'use strict';

const crypto = require('crypto');

/* ------------------------------------------------------------------ */
/* Password hashing — scrypt with per-password salt (never plaintext)  */
/* ------------------------------------------------------------------ */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/* ------------------------------------------------------------------ */
/* Tokens & cookies                                                    */
/* ------------------------------------------------------------------ */

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function randomToken(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const chunk of String(header).split(';')) {
    const idx = chunk.indexOf('=');
    if (idx < 0) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0, expires: new Date(0) });
}

/* ------------------------------------------------------------------ */
/* TOTP (two-factor authentication, RFC 6238)                          */
/* ------------------------------------------------------------------ */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

function verifyTotp(secret, code, window = 1) {
  if (!secret || !/^\d{6}$/.test(String(code || '').trim())) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i += 1) {
    if (safeEqual(totpCode(secret, counter + i), String(code).trim())) return true;
  }
  return false;
}

function otpauthUri(secret, account = 'owner', issuer = 'CLAN KILLI') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* In-memory rate limiting (per key)                                   */
/* ------------------------------------------------------------------ */

const buckets = new Map();

function rateLimit(key, { limit = 10, windowMs = 60000 } = {}) {
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || entry.reset < now) {
    entry = { count: 0, reset: now + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  return { allowed: true, remaining: limit - entry.count };
}

function resetRateLimit(key) {
  buckets.delete(key);
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.reset < now) buckets.delete(key);
  }
}, 60000).unref();

module.exports = {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  safeEqual,
  parseCookies,
  setCookie,
  clearCookie,
  generateTotpSecret,
  verifyTotp,
  totpCode,
  otpauthUri,
  rateLimit,
  resetRateLimit,
};
