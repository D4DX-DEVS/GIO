// Entry pass lifecycle: issue (only for confirmed registrations), store the
// image in DigitalOcean Spaces, links to it, and verify.
const { EntryPass, Registration } = require('../models');
const { STATUS, PASS_STATUS } = require('../config/constants');
const { HttpError } = require('../utils/httpError');
const { generatePassId, parseQrPayload, imageLinkQuery } = require('../utils/passTokens');
const store = require('../providers/assetStore');
const { renderPass } = require('./passRenderer');
const { getEvent } = require('./site');

// Details printed on the pass, frozen at issue. Place, the number of
// accompanying children and the photo only exist for registrations from the
// newer forms; passes for older registrations keep exactly the original fields.
function holderSnapshot(r) {
  const holder = { name: r.name, regNo: r.regNo, district: r.district, area: r.area, unit: r.unit };
  if (r.place) holder.place = r.place;
  if (Array.isArray(r.children)) holder.childrenCount = r.children.length;
  if (r.photo) holder.photo = r.photo;
  return holder;
}

async function markGenerated(registration, pass) {
  const now = new Date();
  // Keeps the original time and status when the image of an older pass is stored later.
  const updated = await Registration.findOneAndUpdate(
    { _id: registration._id, passStatus: PASS_STATUS.NONE },
    { $set: { passId: pass.passId, passStatus: PASS_STATUS.GENERATED, passGeneratedAt: now } },
    { new: true }
  );
  if (updated) Object.assign(registration, { passId: pass.passId, passStatus: updated.passStatus, passGeneratedAt: updated.passGeneratedAt });
}

/**
 * Renders the pass image and stores it in Spaces, once. A pass whose image
 * could not be stored (Spaces unreachable) keeps an empty imageKey and gets
 * its image on the next call.
 */
async function storeImage(pass) {
  if (pass.imageKey) return pass;
  const photo = pass.holder?.photo ? await store.photos.get(pass.holder.photo) : null;
  const png = await renderPass(pass, photo);
  const key = store.passes.newKey(pass.passId, pass.version);
  await store.passes.put(key, png);
  // Another request may have stored an image in the meantime; keep the first.
  // null also matches passes saved before the field existed.
  const saved = await EntryPass.findOneAndUpdate({ _id: pass._id, imageKey: { $in: ['', null] } }, { $set: { imageKey: key } }, { new: true });
  return saved ?? EntryPass.findById(pass._id);
}

/**
 * Returns the active pass for a confirmed registration, with its image
 * stored, creating it if needed. Safe to call repeatedly: a registration
 * never gets two passes (unique index on EntryPass.registration) and pass IDs
 * are unique (unique index on passId).
 */
async function issue(registration, actor = null) {
  if (registration.status !== STATUS.CONFIRMED) {
    throw new HttpError(409, 'An entry pass can only be issued after the registration is confirmed.');
  }

  let pass = await EntryPass.findOne({ registration: registration._id });
  if (!pass) {
    const event = await getEvent();
    for (let attempt = 0; attempt < 5 && !pass; attempt += 1) {
      try {
        pass = await EntryPass.create({
          passId: generatePassId(),
          registration: registration._id,
          holder: holderSnapshot(registration),
          eventSnapshot: { name: event.name, date: event.date, venue: event.venue },
          issuedBy: actor?.id ?? null,
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
        // Lost a race with a concurrent request for the same registration.
        if (err.keyPattern?.registration) pass = await EntryPass.findOne({ registration: registration._id });
        // Otherwise the random pass ID collided; try another.
      }
    }
    if (!pass) throw new Error('Could not allocate a unique pass ID');
  }

  pass = await storeImage(pass);
  await markGenerated(registration, pass);
  return pass;
}

/** CDN address of the stored pass image, or null before it is stored. */
const imageUrl = (pass) => (pass?.imageKey ? store.passes.url(pass.imageKey) : null);

/**
 * Same-origin download link for the registrant's success page. Signed and
 * expiring (PASS_IMAGE_LINK_MINUTES), so it cannot be built from a pass ID.
 */
function downloadUrl(pass) {
  const q = imageLinkQuery(pass.passId, pass.version);
  return `/api/passes/${encodeURIComponent(pass.passId)}/image?v=${q.v}&exp=${q.exp}&sig=${q.sig}&download=1`;
}

/** The stored PNG, storing it first for passes issued before images were kept in Spaces. */
async function imageFile(pass) {
  const stored = await storeImage(pass);
  const png = await store.passes.get(stored.imageKey);
  if (!png) throw new Error(`Pass image ${stored.imageKey} is missing from storage`);
  return { pass: stored, png };
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

module.exports = { issue, storeImage, imageUrl, downloadUrl, imageFile, verify };
