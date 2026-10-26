// Central place for configuration. Every secret comes from the environment;
// nothing sensitive has a default value in source.
require('dotenv').config({ quiet: true });

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : String(v).trim();
}

function int(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}

const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: int('PORT', 5100),
  mongoUri: str('MONGODB_URI'),
  // Public origin of this server, used to build the signed pass-image URL
  // that DXing downloads. Must be reachable from the internet in production.
  publicBaseUrl: str('PUBLIC_BASE_URL').replace(/\/$/, ''),
  // Extra origins allowed to call the API from a browser (dev only, normally
  // empty because the client is served from the same origin).
  corsOrigins: str('CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: str('TRUST_PROXY'),

  jwtSecret: str('JWT_SECRET'),
  sessionHours: int('SESSION_HOURS', 12),
  // Separate key so that rotating it invalidates every QR / image link
  // without logging admins out (and vice versa).
  passSecret: str('PASS_SIGNING_SECRET'),
  passImageLinkMinutes: int('PASS_IMAGE_LINK_MINUTES', 60),

  dxing: {
    // "live" calls the DXing API, "mock" records messages without sending
    // (local development and automated tests).
    mode: str('DXING_MODE', 'mock'),
    baseUrl: str('DXING_BASE_URL', 'https://app.dxing.in/api').replace(/\/$/, ''),
    secret: str('DXING_API_KEY'),
    account: str('DXING_INSTANCE_ID'),
    timeoutMs: int('DXING_TIMEOUT_MS', 30000),
  },

  event: {
    name: str('EVENT_NAME', 'Event'),
    date: str('EVENT_DATE'),
    venue: str('EVENT_VENUE'),
    supportContact: str('SUPPORT_CONTACT'),
  },

  registrationOpen: str('REGISTRATION_OPEN', 'true') !== 'false',

  // Optional comma-separated district list for the form (see config/districts.js).
  districts: str('DISTRICTS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  defaultCountryCode: str('DEFAULT_COUNTRY_CODE', '91').replace(/\D/g, ''),
};

env.isProduction = env.nodeEnv === 'production';

function assertConfig() {
  const missing = [];
  if (!env.mongoUri) missing.push('MONGODB_URI');
  if (env.jwtSecret.length < 32) missing.push('JWT_SECRET (at least 32 characters)');
  if (env.passSecret.length < 32) missing.push('PASS_SIGNING_SECRET (at least 32 characters)');
  if (env.dxing.mode === 'live') {
    if (!env.dxing.secret) missing.push('DXING_API_KEY');
    if (!env.dxing.account) missing.push('DXING_INSTANCE_ID');
    if (!env.publicBaseUrl) missing.push('PUBLIC_BASE_URL (DXing must download the pass image)');
  }
  if (!['live', 'mock'].includes(env.dxing.mode)) missing.push('DXING_MODE must be "live" or "mock"');
  if (missing.length) {
    throw new Error(`Invalid configuration:\n  - ${missing.join('\n  - ')}`);
  }
}

module.exports = { env, assertConfig };
