const { env, assertConfig } = require('./config/env');
const { connectDB } = require('./config/db');
const { createApp } = require('./app');

(async () => {
  try {
    assertConfig();
    await connectDB(env.mongoUri);
    if (env.dxing.mode === 'mock') console.warn('[dxing] DXING_MODE=mock: WhatsApp messages are recorded, not sent.');
    createApp().listen(env.port, () => console.log(`[server] http://localhost:${env.port}`));
  } catch (err) {
    console.error('[server] startup failed:', err.message);
    if (/ECONNREFUSED/.test(err.message)) console.error('[server] MongoDB is not running. For local development, start it with "npm run db" in another terminal.');
    process.exit(1);
  }
})();
