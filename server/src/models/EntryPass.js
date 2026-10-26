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
      // Only on passes issued for form version 2 registrations.
      place: String,
      childrenCount: Number,
    },
    // Event details current when the pass was issued (audit only). The pass
    // image always shows the current published event details.
    eventSnapshot: {
      name: String,
      date: String,
      venue: String,
    },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EntryPass', entryPassSchema);
