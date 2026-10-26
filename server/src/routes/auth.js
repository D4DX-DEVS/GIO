const express = require('express');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { asyncHandler } = require('../utils/httpError');
const authService = require('../services/auth');
const { requireAuth, requireCsrfHeader, issueSession, clearSession } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isProduction ? 20 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
});

router.use(requireCsrfHeader);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    const admin = await authService.authenticate(username, password);
    issueSession(res, admin);
    res.json({ admin: authService.publicProfile(admin) });
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Revokes the token server-side, not just the cookie in this browser.
    await authService.revokeSessions(req.admin._id);
    clearSession(res);
    res.json({ ok: true });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: authService.publicProfile(req.admin) });
});

module.exports = router;
