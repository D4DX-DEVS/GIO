const mongoose = require('mongoose');

const entryPassSchema = new mongoose.Schema(
  {
    passId: { type: String, required: true, unique: true },
    registration: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration', required: true, unique: true },
    // Part of the signed QR code and download link; bumping it invalidates both.
    version: { type: Number, default: 1 },
    // The app only issues active passes. "revoked" lets an operator cancel a
    // pass directly in the database; the gate check and download links honour it.
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    // Details printed on the pass, frozen at issue time.
    holder: {
      name: String,
      regNo: String,
      district: String,
      area: String,
      unit: String,
      // Only on passes issued for form version 2 registrations.
      place: String,
      childrenCount: Number,
      // Photo key; printed on the pass.
      photo: String,
    },
    // Event details printed on the stored pass image.
    eventSnapshot: {
      name: String,
      date: String,
      venue: String,
    },
    // File name of the pass image in DigitalOcean Spaces (see
    // providers/assetStore.js). Empty until the image has been stored.
    imageKey: { type: String, default: '' },
    issuedAt: { type: Date, default: Date.now },
    // null when issued automatically at submission.
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EntryPass', entryPassSchema);
