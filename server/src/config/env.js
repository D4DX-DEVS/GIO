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
  // Extra origins allowed to call the API from a browser (dev only, normally
  // empty because the client is served from the same origin).
  corsOrigins: str('CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: str('TRUST_PROXY'),

  // The only admin account. Plain text, compared directly at sign-in
  // (services/auth.js); the database keeps no password for it.
  admin: {
    username: str('ADMIN_USERNAME').toLowerCase(),
    password: str('ADMIN_PASSWORD'),
  },

  jwtSecret: str('JWT_SECRET'),
  sessionHours: int('SESSION_HOURS', 12),
  // Separate key so that rotating it invalidates every QR / download link
  // without logging admins out (and vice versa).
  passSecret: str('PASS_SIGNING_SECRET'),
  // How long the pass download link on the registration success page works.
  passImageLinkMinutes: int('PASS_IMAGE_LINK_MINUTES', 60),

  event: {
    name: str('EVENT_NAME', 'Event'),
    date: str('EVENT_DATE'),
    venue: str('EVENT_VENUE'),
    supportContact: str('SUPPORT_CONTACT'),
  },

  // EVENT_NAME / EVENT_DATE / EVENT_VENUE above are used until the conference
  // website settings are published in the admin console (services/site.js),
  // for the registration page and the record kept with each entry pass.

  // Hard switch. When false, registration is closed whatever the admin
  // console says; when true, the admin console's switch decides.
  registrationOpen: str('REGISTRATION_OPEN', 'true') !== 'false',

  // DigitalOcean Spaces holds every file: website images and entry pass
  // images (providers/assetStore.js). Files are served from the CDN.
  spaces: {
    key: str('DO_SPACES_KEY'),
    secret: str('DO_SPACES_SECRET'),
    endpoint: str('DO_SPACES_ENDPOINT').replace(/\/$/, ''),
    region: str('DO_SPACES_REGION'),
    bucket: str('DO_SPACES_BUCKET'),
    cdnUrl: str('DO_SPACES_CDN_URL').replace(/\/$/, ''),
    // Optional prefix inside the bucket, e.g. "GIO".
    folder: str('DO_SPACES_FOLDER').replace(/^\/+|\/+$/g, ''),
  },

  // Optional comma-separated district list for the form (see config/districts.js).
  districts: str('DISTRICTS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Calling code of the country preselected for the phone and WhatsApp numbers.
  defaultCountryCode: str('DEFAULT_COUNTRY_CODE', '91').replace(/\D/g, ''),
};

env.isProduction = env.nodeEnv === 'production';

function assertConfig() {
  const missing = [];
  if (!env.mongoUri) missing.push('MONGODB_URI');
  if (!env.admin.username) missing.push('ADMIN_USERNAME');
  if (env.admin.password.length < 10) missing.push('ADMIN_PASSWORD (at least 10 characters)');
  if (env.jwtSecret.length < 32) missing.push('JWT_SECRET (at least 32 characters)');
  if (env.passSecret.length < 32) missing.push('PASS_SIGNING_SECRET (at least 32 characters)');
  for (const [name, value] of [
    ['DO_SPACES_KEY', env.spaces.key],
    ['DO_SPACES_SECRET', env.spaces.secret],
    ['DO_SPACES_ENDPOINT', env.spaces.endpoint],
    ['DO_SPACES_REGION', env.spaces.region],
    ['DO_SPACES_BUCKET', env.spaces.bucket],
    ['DO_SPACES_CDN_URL', env.spaces.cdnUrl],
  ]) {
    if (!value) missing.push(name);
  }
  for (const [name, value] of [['DO_SPACES_ENDPOINT', env.spaces.endpoint], ['DO_SPACES_CDN_URL', env.spaces.cdnUrl]]) {
    if (value && !/^https?:\/\/[^/]+/.test(value)) missing.push(`${name} must be a URL such as https://...`);
  }
  if (missing.length) {
    throw new Error(`Invalid configuration:\n  - ${missing.join('\n  - ')}`);
  }
}

module.exports = { env, assertConfig };
