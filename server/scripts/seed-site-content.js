// Creates the conference website settings from the approved details only.
//
//   npm run seed-site                       # show what would be created
//   npm run seed-site -- --apply            # create the draft and import the logo and poster
//   npm run seed-site -- --apply --publish  # ...and publish it
//
// Approved so far: organiser (GIO Keralam), title (International Conference
// on Women), theme (Being, Becoming, Belonging - Reimagining the Self, Space
// and Society), date (15 November 2026), location (Ernakulam), the logo and
// the poster. Everything else (venue, programme, speakers, contact details,
// fees, gender options, children limits) is left empty until it is supplied.
//
// Safe to run twice: it never changes settings that already exist, and an
// image already in the library is not imported again.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { SiteSettings, Asset } = require('../src/models');
const { EMPTY_PAGE, pageSettings } = require('../src/config/siteSchema');
const assets = require('../src/services/assets');
const content = require('../src/services/siteContent');

const apply = process.argv.includes('--apply');
const publish = process.argv.includes('--publish');
const BRAND = path.resolve(__dirname, '../../client/public/brand');
const actor = { id: null, name: 'Setup script' };

const IMAGES = {
  logo: { file: 'gio-logo-maroon.png', alt: 'GIO Keralam' },
  poster: { file: 'poster.jpg', alt: 'Official poster of the International Conference on Women, 15 November 2026, Ernakulam' },
};

const APPROVED = {
  ...EMPTY_PAGE,
  presenter: 'GIO Keralam presents',
  title: 'International Conference on *Women*',
  intro:
    'GIO Keralam presents the International Conference on Women, on 15 November 2026 in Ernakulam. ' +
    'The theme is Being, Becoming, Belonging: Reimagining the Self, Space and Society.',
  dateText: '15 November 2026',
  location: 'Ernakulam',
  themeShort: 'Being, Becoming, Belonging',
  themeTitle: 'Being, *Becoming,* Belonging',
  themeSubtitle: 'Reimagining the Self, Space and Society',
  posterCaption: 'Official poster',
  posterTag: '15 Nov 2026',
  closingText: '15 November 2026, *Ernakulam*',
  footerText: 'International Conference on Women · GIO Keralam',
  // Sections with no approved text yet stay hidden.
  show: { ...EMPTY_PAGE.show, about: false, gallery: false },
};

async function importImage({ file, alt }) {
  const buffer = fs.readFileSync(path.join(BRAND, file));
  const processed = await assets.processImage(buffer);
  const existing = await Asset.findOne({ key: processed.key });
  if (existing) {
    console.log(`  image ${file}: already in the library`);
    return String(existing._id);
  }
  if (!apply) {
    console.log(`  image ${file}: would import (${processed.width}x${processed.height})`);
    return '';
  }
  const created = await assets.upload(buffer, { alt, originalName: file }, actor);
  console.log(`  image ${file}: imported`);
  return created.id;
}

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  console.log(`Database: ${env.mongoUri.replace(/\/\/[^@/]*@/, '//<credentials>@')}`);
  console.log(`Image storage: ${env.assets.storage}${env.assets.storage === 'local' ? ` (${env.assets.dir})` : ''}`);
  await mongoose.connect(env.mongoUri);

  const existing = await SiteSettings.findById('site').lean();
  if (existing) {
    console.log('Website settings already exist; nothing is changed. Edit them in the admin console.');
  } else {
    const draft = { ...APPROVED };
    draft.logo = await importImage(IMAGES.logo);
    draft.poster = await importImage(IMAGES.poster);
    pageSettings.parse(draft);
    console.log(`Website settings: would create "${draft.title.replace(/\*/g, '')}", ${draft.dateText}, ${draft.location}.`);
    if (apply) {
      const saved = await content.saveSettings(draft, 0, actor);
      console.log('Created the draft.');
      if (publish) {
        await content.publishSettings(saved.version, actor);
        console.log('Published. The website, WhatsApp messages and new pass images now use these details.');
      } else {
        console.log('Not published. Review it in Admin > Website, then publish.');
      }
    }
  }

  console.log(apply ? 'Done.' : 'Nothing was changed. Run again with --apply to create it.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
