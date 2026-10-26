const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { Admin } = require('../models');
const { ROLE_PERMISSIONS } = require('../config/constants');
const { HttpError, asyncHandler } = require('../utils/httpError');

const COOKIE = 'rms_session';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: '/api',
    maxAge: env.sessionHours * 60 * 60 * 1000,
  };
}

function issueSession(res, admin) {
  const token = jwt.sign({ sub: String(admin._id), tv: admin.tokenVersion }, env.jwtSecret, {
    expiresIn: `${env.sessionHours}h`,
    algorithm: 'HS256',
  });
  res.cookie(COOKIE, token, cookieOptions());
}

function clearSession(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE, opts);
}

/**
 * Loads the signed-in admin on every request, so deactivation, role changes
 * and logout (tokenVersion bump) take effect immediately.
 */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Please sign in.');
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  const admin = await Admin.findById(payload.sub);
  if (!admin || !admin.active || admin.tokenVersion !== payload.tv) {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  req.admin = admin;
  req.actor = { id: admin._id, name: admin.name, role: admin.role };
  next();
});

function can(admin, permission) {
  return (ROLE_PERMISSIONS[admin?.role] || []).includes(permission);
}

const requirePermission = (permission) => (req, _res, next) => {
  if (!can(req.admin, permission)) return next(new HttpError(403, 'You do not have permission to do this.'));
  return next();
};

// The session cookie is SameSite=Strict; requiring a custom header on
// state-changing requests adds a second CSRF barrier (browsers will not send
// it cross-site without a CORS preflight we do not allow).
function requireCsrfHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'rms') return next(new HttpError(403, 'Missing request header.'));
  return next();
}

module.exports = { requireAuth, requirePermission, requireCsrfHeader, issueSession, clearSession, can, COOKIE };
