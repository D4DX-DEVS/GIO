// Lists stored image files that no library entry points at (for example
// after a crash between storing a file and saving its record).
//
//   npm run assets-cleanup              # list them
//   npm run assets-cleanup -- --apply   # delete them
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { Asset } = require('../src/models');
const store = require('../src/providers/assetStore');

const apply = process.argv.includes('--apply');

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(env.mongoUri);
  const keys = await store.list();
  const used = new Set((await Asset.find().select('key').lean()).map((a) => a.key));
  const orphans = keys.filter((k) => !used.has(k));
  console.log(`${keys.length} stored file(s), ${orphans.length} without a library entry.`);
  for (const key of orphans) {
    console.log(`  ${key}`);
    if (apply) await store.remove(key);
  }
  console.log(apply ? 'Done.' : 'Nothing was changed. Run again with --apply to delete them.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
