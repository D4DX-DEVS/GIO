// Notification service: records each WhatsApp message and makes sure each
// logical message is sent at most once. It knows nothing about workflow
// rules; the registrations service decides when to call it.
//
// It never throws provider failures at callers. It returns
//   { ok: true,  notification }                 accepted by DXing
//   { ok: true,  notification, duplicate: true } already sent / in flight, skipped
//   { ok: false, notification, error }          failed (recorded, can be retried)
const { Notification, EntryPass } = require('../models');
const { TEMPLATE } = require('../config/constants');
const { env } = require('../config/env');
const dxing = require('../providers/dxing');
const { buildText } = require('./templates');
const { toProviderRecipient } = require('../utils/phone');
const { imageLinkQuery } = require('../utils/passTokens');

// A record stuck in "sending" this long (e.g. the process crashed mid-send)
// may be claimed again.
const STALE_SENDING_MS = 5 * 60 * 1000;

function actorFields(actor) {
  return actor
    ? { triggeredBy: actor.id, triggeredByName: actor.name }
    : { triggeredBy: null, triggeredByName: 'system' };
}

function passImageUrl(pass) {
  const q = imageLinkQuery(pass.passId, pass.version);
  const base = env.publicBaseUrl || `http://localhost:${env.port}`;
  return `${base}/api/passes/${encodeURIComponent(pass.passId)}/image?v=${q.v}&exp=${q.exp}&sig=${q.sig}`;
}

async function deliver(notification, registration) {
  const recipient = toProviderRecipient(registration.mobile);
  if (notification.template === TEMPLATE.PASS) {
    const pass = await EntryPass.findOne({ registration: registration._id, status: 'active' });
    if (!pass) throw new dxing.ProviderError('No active entry pass for this registration.', { retryable: false });
    const caption = buildText(notification.template, { registration, pass });
    // The image link is signed per attempt, so a retry gets a fresh, unexpired link.
    const result = await dxing.sendImage(recipient, passImageUrl(pass), caption);
    return { ...result, message: caption };
  }
  const message = buildText(notification.template, { registration });
  const result = await dxing.sendText(recipient, message);
  return { ...result, message };
}

async function run(notification, registration) {
  try {
    const { messageId, message } = await deliver(notification, registration);
    notification.set({ status: 'accepted', acceptedAt: new Date(), lastError: '', providerMessageId: messageId, message });
    await notification.save();
    return { ok: true, notification };
  } catch (err) {
    const known = err instanceof dxing.ProviderError;
    const error = known ? err.message : 'Unexpected error while sending the message.';
    // Log the reason, never the request body (it carries the API secret).
    console.error(`[notifications] ${notification.template} for ${notification.registration} failed: ${known ? err.message : err.stack}`);
    notification.set({ status: 'failed', lastError: error });
    await notification.save();
    return { ok: false, notification, error };
  }
}

/**
 * Records and sends one message identified by dedupeKey. If a record with
 * that key already exists, nothing is sent.
 */
async function send({ registration, template, dedupeKey, actor }) {
  let notification;
  try {
    notification = await Notification.create({
      registration: registration._id,
      template,
      recipient: registration.mobile,
      dedupeKey,
      status: 'sending',
      attempts: 1,
      ...actorFields(actor),
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const existing = await Notification.findOne({ dedupeKey });
    return { ok: existing?.status !== 'failed', notification: existing, duplicate: true, error: existing?.lastError || null };
  }
  return run(notification, registration);
}

/**
 * Re-sends a failed message. Claims the record atomically so two clicks
 * cannot both send. Returns null when the record is not retryable.
 */
async function retry(notificationId, registration, actor) {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const claimed = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      registration: registration._id,
      $or: [{ status: 'failed' }, { status: 'sending', updatedAt: { $lt: staleBefore } }],
    },
    { $set: { status: 'sending', ...actorFields(actor) }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!claimed) return null;
  return run(claimed, registration);
}

// The workflow-level message for entering a status. The key includes the
// position in the status history, so saving the same transition twice can
// never send twice, while a genuinely new transition (e.g. after a reopen)
// gets its own message.
function statusMessage(registration, template, actor) {
  return send({
    registration,
    template,
    dedupeKey: `${registration._id}:${template}:${registration.statusHistory.length}`,
    actor,
  });
}

/**
 * Sends the entry pass image. `sequence` separates the first send from
 * explicit resends; two concurrent requests computing the same sequence
 * collide on the unique key and only one message goes out.
 */
async function sendPass(registration, pass, actor) {
  const sequence = (await Notification.countDocuments({ registration: registration._id, template: TEMPLATE.PASS })) + 1;
  return send({
    registration,
    template: TEMPLATE.PASS,
    dedupeKey: `${registration._id}:${TEMPLATE.PASS}:v${pass.version}:${sequence}`,
    actor,
  });
}

function lastMessage(registrationId, template) {
  return Notification.findOne({ registration: registrationId, template }).sort({ createdAt: -1 });
}

module.exports = { send, statusMessage, sendPass, retry, lastMessage, passImageUrl };
