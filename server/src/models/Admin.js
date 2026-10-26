const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.STAFF },
    active: { type: Boolean, default: true },
    // Incremented on logout / password change; tokens carrying an older value
    // are rejected, which gives server-side session revocation.
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', adminSchema);
