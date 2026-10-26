const mongoose = require('mongoose');
const { STATUSES, STATUS, PASS_STATUSES, PASS_STATUS, AGE_MIN, AGE_MAX } = require('../config/constants');

const historySchema = new mongoose.Schema(
  {
    from: { type: String, enum: [null, ...STATUSES], default: null },
    to: { type: String, enum: STATUSES, required: true },
    // null for the system (public submission)
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    byName: { type: String, default: 'system' },
    note: { type: String, maxlength: 500, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    regNo: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Lower-cased, whitespace-collapsed name used for duplicate detection.
    nameKey: { type: String, required: true },
    age: { type: Number, required: true, min: AGE_MIN, max: AGE_MAX },
    // Stored in E.164 form, e.g. +919876543210
    mobile: { type: String, required: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    district: { type: String, required: true, trim: true, maxlength: 100 },
    area: { type: String, required: true, trim: true, maxlength: 100 },
    unit: { type: String, required: true, trim: true, maxlength: 100 },

    status: { type: String, enum: STATUSES, default: STATUS.SUBMITTED, index: true },
    statusChangedAt: { type: Date, default: Date.now },
    statusHistory: { type: [historySchema], default: [] },

    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    confirmedByName: { type: String, default: '' },

    // Client-generated key that makes a resubmitted request (double tap,
    // network retry) return the original registration.
    submissionKey: { type: String, unique: true, sparse: true },

    passId: { type: String, default: null },
    passStatus: { type: String, enum: PASS_STATUSES, default: PASS_STATUS.NONE, index: true },
    passGeneratedAt: { type: Date, default: null },
    passSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Same person registering twice with the same mobile is treated as a duplicate.
registrationSchema.index({ mobile: 1, nameKey: 1 }, { unique: true });
registrationSchema.index({ createdAt: -1 });
registrationSchema.index({ district: 1, area: 1, unit: 1 });
registrationSchema.index({ passId: 1 }, { sparse: true });

// Shape returned to admin clients.
registrationSchema.methods.toAdminJSON = function toAdminJSON() {
  const o = this.toObject({ versionKey: false });
  delete o.nameKey;
  delete o.submissionKey;
  return o;
};

module.exports = mongoose.model('Registration', registrationSchema);
