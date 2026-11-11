// Event day check-in and check-out. Each entry pass is scanned once to check
// in and once to check out, in that order.
//
// The rule is enforced by conditional updates: the update only matches while
// the time field is still empty, so when two gates scan the same pass at the
// same moment exactly one of them records it and the other is told it was
// already scanned.
const { Registration } = require('../models');
const { HttpError } = require('../utils/httpError');
const passes = require('./passes');

const FIELDS = {
  in: { at: 'checkedInAt', by: 'checkedInBy', byName: 'checkedInByName' },
  out: { at: 'checkedOutAt', by: 'checkedOutBy', byName: 'checkedOutByName' },
};
const ACTIONS = Object.keys(FIELDS);

// A null query value matches both null and a missing field (records saved
// before attendance existed).
const NOT_YET = null;
const DONE = { $ne: null };

/**
 * Checks a scanned QR value (or typed pass ID) and records the check-in or
 * check-out. Returns one of
 *   { result: 'ok', registration }               recorded now
 *   { result: 'already', registration }          scanned before; the time is on the registration
 *   { result: 'not_checked_in', registration }   check-out of a pass that was never checked in
 *   { result: 'invalid', reason }                a passes.verify() reason
 */
async function scan(code, action, actor) {
  const f = FIELDS[action];
  const check = await passes.verify(code);
  if (!check.valid) return { result: 'invalid', reason: check.reason };

  const id = check.registration._id;
  const condition = action === 'in' ? { checkedInAt: NOT_YET } : { checkedInAt: DONE, checkedOutAt: NOT_YET };
  const updated = await Registration.findOneAndUpdate(
    { _id: id, ...condition },
    { $set: { [f.at]: new Date(), [f.by]: actor.id, [f.byName]: actor.name } },
    { new: true }
  );
  if (updated) return { result: 'ok', registration: updated };

  const current = await Registration.findById(id);
  // Deleted between the check and the update.
  if (!current) return { result: 'invalid', reason: 'not_found' };
  if (action === 'out' && !current.checkedInAt) return { result: 'not_checked_in', registration: current };
  return { result: 'already', registration: current };
}

/**
 * Admin correction of a wrong scan: clears the check-in or check-out so the
 * pass can be scanned again. A check-in can only be undone while the person
 * is not checked out, so a check-out never exists without a check-in.
 */
async function undo(id, action, actor) {
  const f = FIELDS[action];
  const condition = action === 'in' ? { checkedInAt: DONE, checkedOutAt: NOT_YET } : { checkedOutAt: DONE };
  const updated = await Registration.findOneAndUpdate(
    { _id: id, ...condition },
    { $set: { [f.at]: null, [f.by]: null, [f.byName]: '' } },
    { new: true }
  );
  if (updated) {
    console.log(`[attendance] ${actor.name} undid the check-${action} of ${updated.regNo}`);
    return updated;
  }

  const current = await Registration.findById(id);
  if (!current) throw new HttpError(404, 'Registration not found.');
  if (action === 'in' && current.checkedOutAt) throw new HttpError(409, 'This person is checked out. Undo the check-out first.');
  throw new HttpError(409, action === 'in' ? 'This person is not checked in.' : 'This person is not checked out.');
}

// Truthy when the date field is set, for $cond.
const isSet = (field) => ({ $ifNull: [`$${field}`, false] });
const childrenOf = { $size: { $ifNull: ['$children', []] } };

/** Head counts for the check-in and check-out pages. Children are those registered with each person. */
async function stats() {
  const [row] = await Registration.aggregate([
    {
      $group: {
        _id: null,
        registrations: { $sum: 1 },
        checkedIn: { $sum: { $cond: [isSet('checkedInAt'), 1, 0] } },
        checkedInChildren: { $sum: { $cond: [isSet('checkedInAt'), childrenOf, 0] } },
        checkedOut: { $sum: { $cond: [isSet('checkedOutAt'), 1, 0] } },
        checkedOutChildren: { $sum: { $cond: [isSet('checkedOutAt'), childrenOf, 0] } },
      },
    },
  ]);
  const n = (k) => row?.[k] ?? 0;
  return {
    registrations: n('registrations'),
    checkedIn: n('checkedIn'),
    checkedInChildren: n('checkedInChildren'),
    checkedOut: n('checkedOut'),
    checkedOutChildren: n('checkedOutChildren'),
    // A check-out always follows a check-in, so the difference is who is still inside.
    inside: n('checkedIn') - n('checkedOut'),
    insideChildren: n('checkedInChildren') - n('checkedOutChildren'),
  };
}

module.exports = { ACTIONS, scan, undo, stats };
