// Read-only check, run before every deploy: compares the indexes the code
// declares with the indexes in the database. The server runs syncIndexes() at
// start-up, which drops indexes the code no longer declares, so a non-empty
// "would drop" list must be reviewed before deploying.
//
//   npm run check-indexes
//
// Exits with code 1 when an index would be dropped. Changes nothing.
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  console.log(`Database: ${env.mongoUri.replace(/\/\/[^@/]*@/, '//<credentials>@')}`);
  await mongoose.connect(env.mongoUri);
  const existing = new Set((await mongoose.connection.db.listCollections().toArray()).map((c) => c.name));
  let drops = 0;
  for (const model of Object.values(mongoose.models)) {
    const name = model.collection.collectionName;
    if (!existing.has(name)) {
      console.log(`${name}: new collection, its indexes will be created`);
      continue;
    }
    const { toDrop, toCreate } = await model.diffIndexes();
    drops += toDrop.length;
    const parts = [
      toDrop.length ? `WOULD DROP ${toDrop.join(', ')}` : '',
      toCreate.length ? `would create ${toCreate.map((k) => JSON.stringify(k)).join(', ')}` : '',
    ].filter(Boolean);
    console.log(`${name}: ${parts.length ? parts.join('; ') : 'no change'}`);
  }
  await mongoose.disconnect();
  if (drops) {
    console.error(`\n${drops} index(es) would be dropped at start-up. Review before deploying.`);
    process.exit(1);
  }
  console.log('\nNo existing index would be dropped.');
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
