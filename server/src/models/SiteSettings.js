const mongoose = require('mongoose');

// The conference website's page settings: a single document (_id "site")
// holding the draft being edited and the copy visitors see. Validation lives
// in config/siteSchema.js; here the content is stored as given.
const siteSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'site' },
    draft: { type: mongoose.Schema.Types.Mixed, required: true },
    // null until the first publish.
    published: { type: mongoose.Schema.Types.Mixed, default: null },
    // Incremented on every write; a save carrying an older version is refused
    // so two admins cannot silently overwrite each other.
    version: { type: Number, default: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    updatedByName: { type: String, default: '' },
    publishedAt: { type: Date, default: null },
    publishedByName: { type: String, default: '' },
    // The last few published copies, newest first, kept for reference and
    // for restoring by hand if a publish was a mistake.
    previous: { type: [{ _id: false, content: mongoose.Schema.Types.Mixed, publishedAt: Date, publishedByName: String }], default: [] },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
