const mongoose = require('mongoose');

// An image in the website's library. The file itself is in the asset store
// (providers/assetStore.js) under `key`, which is derived from the content
// hash, so a replaced image gets a new URL and caches never serve the old one.
const assetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    sha256: { type: String, required: true },
    mime: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
    size: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    alt: { type: String, trim: true, maxlength: 300, required: true },
    caption: { type: String, trim: true, maxlength: 300, default: '' },
    originalName: { type: String, trim: true, maxlength: 200, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    uploadedByName: { type: String, default: '' },
    replacedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

assetSchema.index({ key: 1 });

module.exports = mongoose.model('Asset', assetSchema);
