// Lists files in DigitalOcean Spaces that nothing points at:
//   - website images without a library entry (for example after a crash
//     between storing a file and saving its record)
//   - registrants' photos that were uploaded on the form but never submitted
//     (only those older than a day, so a form being filled in is not touched)
//
//   npm run assets-cleanup              # list them
//   npm run assets-cleanup -- --apply   # delete them
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { Asset, Registration } = require('../src/models');
const store = require('../src/providers/assetStore');

const apply = process.argv.includes('--apply');
const DAY_MS = 24 * 60 * 60 * 1000;

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(env.mongoUri);

  const keys = await store.list();
  const used = new Set((await Asset.find().select('key').lean()).map((a) => a.key));
  const orphans = keys.filter((k) => !used.has(k));
  console.log(`${keys.length} website image file(s), ${orphans.length} without a library entry.`);
  for (const key of orphans) {
    console.log(`  ${key}`);
    if (apply) await store.remove(key);
  }

  const photos = await store.photos.list();
  const usedPhotos = new Set((await Registration.find({ photo: { $exists: true } }).select('photo').lean()).map((r) => r.photo));
  const unused = photos.filter((p) => !usedPhotos.has(p.name) && p.modified && Date.now() - p.modified.getTime() > DAY_MS);
  console.log(`${photos.length} photo(s), ${unused.length} uploaded more than a day ago and never submitted.`);
  for (const p of unused) {
    console.log(`  ${p.name}`);
    if (apply) await store.photos.remove(p.name);
  }

  console.log(apply ? 'Done.' : 'Nothing was changed. Run again with --apply to delete them.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
