const mongoose = require('mongoose');
const { env, assertConfig } = require('./config/env');
const { connectDB } = require('./config/db');
const { createApp } = require('./app');

(async () => {
  try {
    assertConfig();
    await connectDB(env.mongoUri);
    if (env.dxing.mode === 'mock') console.warn('[dxing] DXING_MODE=mock: WhatsApp messages are recorded, not sent.');
    const server = createApp().listen(env.port, () => console.log(`[server] http://localhost:${env.port}`));

    // The host (App Platform, Docker) stops the old instance with SIGTERM on
    // every deploy. Let in-flight requests finish, such as a confirmation
    // that is still sending its WhatsApp messages, then exit.
    process.once('SIGTERM', () => {
      console.log('[server] SIGTERM received, finishing open requests');
      server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
      });
    });
  } catch (err) {
    console.error('[server] startup failed:', err.message);
    if (/ECONNREFUSED/.test(err.message)) console.error('[server] MongoDB is not running. For local development, start it with "npm run db" in another terminal.');
    process.exit(1);
  }
})();
