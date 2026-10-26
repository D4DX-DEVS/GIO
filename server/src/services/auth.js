const bcrypt = require('bcryptjs');
const { Admin } = require('../models');
const { HttpError } = require('../utils/httpError');
const { ROLE_PERMISSIONS } = require('../config/constants');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 12;
// Compared against when the username does not exist, so response time does
// not reveal which usernames are valid.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  return null;
}

async function authenticate(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new HttpError(400, 'Username and password are required.');
  }
  const admin = await Admin.findOne({ username: username.trim().toLowerCase() }).select('+passwordHash');
  const ok = await bcrypt.compare(password.slice(0, 128), admin ? admin.passwordHash : DUMMY_HASH);

  if (!admin || !admin.active) throw new HttpError(401, 'Invalid username or password.');
  if (admin.lockUntil && admin.lockUntil > new Date()) {
    throw new HttpError(423, 'Too many failed attempts. Try again in a few minutes.');
  }
  if (!ok) {
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

module.exports = { authenticate, hashPassword, validatePassword, revokeSessions, publicProfile };
