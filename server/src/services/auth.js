const crypto = require('crypto');
const { Admin } = require('../models');
const { env } = require('../config/env');
const { HttpError } = require('../utils/httpError');
const { ROLES, ROLE_PERMISSIONS } = require('../config/constants');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// Compares fixed-length digests, so the time taken does not depend on how
// much of the input matches or how long it is.
function safeEqual(a, b) {
  const digest = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * The admin signs in with ADMIN_USERNAME / ADMIN_PASSWORD from the
 * environment. Its Admin record holds no password, only session and lockout
 * state, and its id is what audit fields (confirmedBy, updatedBy...) store.
 */
function envAdminRecord() {
  return Admin.findOneAndUpdate(
    { username: env.admin.username },
    { $set: { role: ROLES.ADMIN, active: true }, $setOnInsert: { name: env.admin.username } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function authenticate(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new HttpError(400, 'Username and password are required.');
  }
  if (!env.admin.username || !env.admin.password) throw new HttpError(503, 'Admin sign-in is not configured.');
  const userOk = safeEqual(username.trim().toLowerCase(), env.admin.username);
  const passOk = safeEqual(password, env.admin.password);
  // Loaded whatever the username, so response time does not reveal it.
  const admin = await envAdminRecord();

  if (!userOk) throw new HttpError(401, 'Invalid username or password.');
  if (admin.lockUntil && admin.lockUntil > new Date()) {
    throw new HttpError(423, 'Too many failed attempts. Try again in a few minutes.');
  }
  if (!passOk) {
    const failed = admin.failedLogins + 1;
    const update = failed >= MAX_FAILED
      ? { failedLogins: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
      : { failedLogins: failed };
    await Admin.updateOne({ _id: admin._id }, { $set: update });
    throw new HttpError(401, 'Invalid username or password.');
  }

  admin.failedLogins = 0;
  admin.lockUntil = null;
  admin.lastLoginAt = new Date();
  await admin.save();
  return admin;
}

async function revokeSessions(adminId) {
  await Admin.updateOne({ _id: adminId }, { $inc: { tokenVersion: 1 } });
}

function publicProfile(admin) {
  return {
    id: admin._id,
    username: admin.username,
    name: admin.name,
    role: admin.role,
    permissions: ROLE_PERMISSIONS[admin.role] || [],
  };
}

module.exports = { authenticate, revokeSessions, publicProfile };
