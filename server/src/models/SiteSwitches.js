const mongoose = require('mongoose');

// Website switches that apply as soon as an admin changes them, outside the
// draft and publish steps of SiteSettings, so they also work before the
// website is first published. A single document (_id "site").
const siteSwitchesSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'site' },
    showRegisterButton: { type: Boolean, default: true },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteSwitches', siteSwitchesSchema);
