// One-time migration to the Submitted -> Confirmed workflow.
//
//   npm run migrate              # show what would change
//   npm run migrate -- --apply   # change it
//
// Older versions stored statuses that are no longer part of the workflow.
// This script:
//   - moves any registration with a status other than Submitted or Confirmed
//     back to "submitted" (awaiting confirmation) so an admin can decide; a
//     pass that was cancelled stays cancelled in entrypasses and the
//     registration's pass status is reset to "not_generated"
//   - removes steps with those old statuses from the status history, keeping
//     the rest of the history (who confirmed and when)
//   - deletes nothing else; notification records are left as they are
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { STATUS, STATUSES, PASS_STATUS, PASS_STATUSES } = require('../src/config/constants');

const apply = process.argv.includes('--apply');

function cleanHistory(history) {
  const kept = [];
  for (const h of history || []) {
    if (!STATUSES.includes(h.to)) continue;
    const prev = kept.at(-1);
    // Skip a repeat of the status we are already in (e.g. submitted -> old status -> submitted).
    if (prev && prev.to === h.to) continue;
    kept.push({ ...h, from: prev ? prev.to : null });
  }
  return kept;
}

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(env.mongoUri);
  const col = mongoose.connection.db.collection('registrations');

  const legacy = await col
    .find({
      $or: [
        { status: { $nin: STATUSES } },
        { passStatus: { $nin: PASS_STATUSES } },
        // $elemMatch: a plain $nin on an array field would mean "no element matches".
        { statusHistory: { $elemMatch: { to: { $nin: STATUSES } } } },
        { statusHistory: { $elemMatch: { from: { $nin: [null, ...STATUSES] } } } },
      ],
    })
    .toArray();

  console.log(`${legacy.length} registration(s) use the old workflow.`);
  for (const r of legacy) {
    const set = {};
    if (!STATUSES.includes(r.status)) {
      set.status = STATUS.SUBMITTED;
      set.statusChangedAt = new Date();
    }
    const status = set.status ?? r.status;
    if (!PASS_STATUSES.includes(r.passStatus) || (status === STATUS.SUBMITTED && r.passStatus !== PASS_STATUS.NONE)) {
      Object.assign(set, { passStatus: PASS_STATUS.NONE, passId: null, passGeneratedAt: null, passSentAt: null });
    }
    set.statusHistory = cleanHistory(r.statusHistory);
    if (status === STATUS.CONFIRMED && !r.confirmedAt) {
      const step = [...set.statusHistory].reverse().find((h) => h.to === STATUS.CONFIRMED);
      if (step) Object.assign(set, { confirmedAt: step.at, confirmedBy: step.by ?? null, confirmedByName: step.byName ?? '' });
    }
    console.log(`  ${r.regNo}: ${r.status} -> ${status}; history ${r.statusHistory.length} -> ${set.statusHistory.length} step(s)`);
    if (apply) await col.updateOne({ _id: r._id }, { $set: set });
  }

  // Confirmed registrations from before confirmedAt existed.
  const undated = await col.find({ status: STATUS.CONFIRMED, confirmedAt: { $in: [null, undefined] } }).toArray();
  for (const r of undated) {
    if (legacy.some((l) => l._id.equals(r._id))) continue;
    const step = [...(r.statusHistory || [])].reverse().find((h) => h.to === STATUS.CONFIRMED);
    if (!step) continue;
    console.log(`  ${r.regNo}: record confirmation time ${step.at.toISOString()}`);
    if (apply) {
      await col.updateOne({ _id: r._id }, { $set: { confirmedAt: step.at, confirmedBy: step.by ?? null, confirmedByName: step.byName ?? '' } });
    }
  }

  console.log(apply ? 'Done.' : 'Nothing was changed. Run again with --apply to migrate.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
