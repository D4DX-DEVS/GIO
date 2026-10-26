// One-time cleanup of district values saved before the district had to come
// from the list (config/districts.js).
//
//   npm run normalize-districts              # show what would change
//   npm run normalize-districts -- --apply   # change it
//
// This script:
//   - rewrites a registration's district to the listed spelling when it is a
//     different case or spacing of a listed district, or an older English name
//     of one (e.g. "calicut" -> "Kozhikode")
//   - leaves every other unlisted value as it is and prints it, so an admin can
//     decide; no registration is deleted
//   - does not touch entry passes: they keep the details printed on the pass
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { districts, matchDistrict } = require('../src/config/districts');

const apply = process.argv.includes('--apply');

// Older English names of Kerala districts.
const ALIASES = {
  trivandrum: 'Thiruvananthapuram',
  quilon: 'Kollam',
  alleppey: 'Alappuzha',
  cochin: 'Ernakulam',
  kochi: 'Ernakulam',
  trichur: 'Thrissur',
  palghat: 'Palakkad',
  calicut: 'Kozhikode',
  cannanore: 'Kannur',
  kasargod: 'Kasaragod',
  kasaragode: 'Kasaragod',
};

function canonical(value) {
  const listed = matchDistrict(value);
  if (listed) return listed;
  const alias = ALIASES[String(value).trim().toLowerCase().replace(/\s+/g, ' ')];
  return alias && matchDistrict(alias);
}

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(env.mongoUri);
  const col = mongoose.connection.db.collection('registrations');

  const odd = await col.find({ district: { $nin: districts() } }).toArray();
  console.log(`${odd.length} registration(s) have a district that is not in the list.`);
  const unresolved = [];
  for (const r of odd) {
    const to = canonical(r.district);
    if (!to) {
      unresolved.push(r);
      continue;
    }
    console.log(`  ${r.regNo}: "${r.district}" -> "${to}"`);
    if (apply) await col.updateOne({ _id: r._id }, { $set: { district: to } });
  }
  for (const r of unresolved) {
    console.log(`  ${r.regNo}: "${r.district}" is not a known district; left unchanged (${r.name}, ${r.mobile})`);
  }

  console.log(apply ? 'Done.' : 'Nothing was changed. Run again with --apply to update.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
