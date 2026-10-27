const mongoose = require('mongoose');
const { ITEM_KINDS } = require('../config/siteSchema');

// Programme items, speakers, announcements, FAQs and gallery images on the
// conference website. Each item has a draft (what admins edit) and a
// published copy (what visitors see, null while unpublished).
const contentItemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ITEM_KINDS, required: true },
    draft: { type: mongoose.Schema.Types.Mixed, required: true },
    published: { type: mongoose.Schema.Types.Mixed, default: null },
    order: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    createdByName: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    updatedByName: { type: String, default: '' },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

contentItemSchema.index({ kind: 1, order: 1 });

module.exports = mongoose.model('ContentItem', contentItemSchema);
