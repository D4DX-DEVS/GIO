const mongoose = require('mongoose');

// One record per message the system intends to send. The unique dedupeKey is
// what stops the same message going out twice.
const notificationSchema = new mongoose.Schema(
  {
    registration: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration', required: true, index: true },
    template: { type: String, required: true },
    channel: { type: String, default: 'whatsapp' },
    provider: { type: String, default: 'dxing' },
    recipient: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true },
    // "accepted" = DXing accepted the request. It is not a delivery receipt.
    status: { type: String, enum: ['sending', 'accepted', 'failed'], default: 'sending' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    providerMessageId: { type: String, default: '' },
    message: { type: String, default: '' },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    triggeredByName: { type: String, default: 'system' },
    acceptedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
