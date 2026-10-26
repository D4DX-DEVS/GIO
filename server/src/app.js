const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { env } = require('./config/env');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', /^\d+$/.test(env.trustProxy) ? Number(env.trustProxy) : env.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: env.isProduction ? [] : null,
        },
      },
      // Pass images are fetched by DXing from another origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // Optional: allow a separately hosted client during development.
  if (env.corsOrigins.length) {
    app.use('/api', (req, res, next) => {
      const origin = req.get('Origin');
      if (origin && env.corsOrigins.includes(origin)) {
        res.set({
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Idempotency-Key',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          Vary: 'Origin',
        });
        if (req.method === 'OPTIONS') return res.sendStatus(204);
      }
      return next();
    });
  }

  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/public', require('./routes/public'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/passes', require('./routes/passes'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built client (single origin keeps the session cookie first-party).
  const dist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('[server] error:', err);
    const body = { error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message };
    if (err.fields) body.fields = err.fields;
    if (err.code && typeof err.code === 'string') body.code = err.code;
    return res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp };
