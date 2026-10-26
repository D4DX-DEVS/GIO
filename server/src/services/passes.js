// Entry pass lifecycle: issue (only for confirmed registrations), render and
// verify.
const { EntryPass, Registration } = require('../models');
const { STATUS, PASS_STATUS } = require('../config/constants');
const { HttpError } = require('../utils/httpError');
const { generatePassId, parseQrPayload } = require('../utils/passTokens');
const { renderPass } = require('./passRenderer');
const { getEvent } = require('./site');

// Details printed on the pass, frozen at issue. Place and the number of
// accompanying children only exist for registrations from the new form;
// passes for older registrations keep exactly the original fields.
function holderSnapshot(r) {
  const holder = { name: r.name, regNo: r.regNo, district: r.district, area: r.area, unit: r.unit };
  if (r.place) holder.place = r.place;
  if (Array.isArray(r.children)) holder.childrenCount = r.children.length;
  return holder;
}

async function markGenerated(registration, pass) {
  const now = new Date();
  await Registration.updateOne(
    { _id: registration._id },
    { $set: { passId: pass.passId, passStatus: PASS_STATUS.GENERATED, passGeneratedAt: now, passSentAt: null } }
  );
  Object.assign(registration, { passId: pass.passId, passStatus: PASS_STATUS.GENERATED, passGeneratedAt: now, passSentAt: null });
}

/**
 * Returns the active pass for a confirmed registration, creating it if needed.
 * Safe to call repeatedly: a registration never gets two passes (unique index
 * on EntryPass.registration) and pass IDs are unique (unique index on passId).
 */
async function issue(registration, actor) {
  if (registration.status !== STATUS.CONFIRMED) {
    throw new HttpError(409, 'An entry pass can only be issued after the registration is confirmed.');
  }

  const existing = await EntryPass.findOne({ registration: registration._id });
  if (existing) return existing;

  const event = await getEvent();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const pass = await EntryPass.create({
        passId: generatePassId(),
        registration: registration._id,
        holder: holderSnapshot(registration),
        eventSnapshot: { name: event.name, date: event.date, venue: event.venue },
        issuedBy: actor.id,
      });
      await markGenerated(registration, pass);
      return pass;
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Lost a race with a concurrent request for the same registration.
      if (err.keyPattern?.registration) return EntryPass.findOne({ registration: registration._id });
      // Otherwise the random pass ID collided; try another.
    }
  }
  throw new Error('Could not allocate a unique pass ID');
}

async function render(pass) {
  return renderPass(pass, await getEvent());
}

/**
 * Checks a scanned QR value (or a typed pass ID).
 * Returns { valid, reason, signed, pass, registration }.
 */
async function verify(code) {
  const parsed = parseQrPayload(code);
  if (!parsed) return { valid: false, reason: 'invalid_code' };

  const pass = await EntryPass.findOne({ passId: parsed.passId });
  if (!pass) return { valid: false, reason: 'not_found' };
  if (parsed.signed && parsed.version !== pass.version) return { valid: false, reason: 'outdated', pass };
  if (pass.status !== 'active') return { valid: false, reason: 'revoked', pass };

  const registration = await Registration.findById(pass.registration);
  if (!registration || registration.status !== STATUS.CONFIRMED) {
    return { valid: false, reason: 'not_confirmed', pass, registration };
  }
  return { valid: true, signed: parsed.signed, pass, registration };
}

module.exports = { issue, render, verify };
