const mongoose = require('mongoose');

const entryPassSchema = new mongoose.Schema(
  {
    passId: { type: String, required: true, unique: true },
    registration: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration', required: true, unique: true },
    // Part of the signed QR code and image link; bumping it invalidates both.
    version: { type: Number, default: 1 },
    // The app only issues active passes. "revoked" lets an operator cancel a
    // pass directly in the database; the gate check and image links honour it.
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    // Details printed on the pass, frozen at issue time.
    holder: {
      name: String,
      regNo: String,
      district: String,
      area: String,
      unit: String,
    },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EntryPass', entryPassSchema);
