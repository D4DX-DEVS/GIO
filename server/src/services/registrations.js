// Registration business logic: submission, status transitions and the
// side effects each transition triggers (entry pass, WhatsApp messages).
// Message sending itself lives in ./notifications.
const { Registration, Counter, EntryPass, Notification } = require('../models');
const { STATUS, TRANSITIONS, TEMPLATE, PASS_STATUS } = require('../config/constants');
const { HttpError } = require('../utils/httpError');
const notifications = require('./notifications');
const passes = require('./passes');

const RESEND_COOLDOWN_MS = 60 * 1000;

const nameKeyOf = (name) => name.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

const DUPLICATE = () =>
  new HttpError(409, 'A registration with this name and mobile number already exists.', { code: 'duplicate' });

function summarize(result) {
  if (!result) return null;
  return {
    ok: result.ok,
    duplicate: Boolean(result.duplicate),
    error: result.error || null,
    template: result.notification?.template ?? null,
  };
}

/**
 * Public submission. Returns { registration, created, acknowledgement }.
 * `created` is false when the same submission key was already processed
 * (double tap, network retry), in which case nothing new is saved or sent.
 */
async function submit(data, submissionKey) {
  if (submissionKey) {
    const previous = await Registration.findOne({ submissionKey });
    if (previous) return { registration: previous, created: false };
  }

  const nameKey = nameKeyOf(data.name);
  if (await Registration.exists({ mobile: data.mobile, nameKey })) throw DUPLICATE();

  const seq = await Counter.next('registration');
  let registration;
  try {
    registration = await Registration.create({
      ...data,
      nameKey,
      regNo: `REG-${String(seq).padStart(5, '0')}`,
      status: STATUS.SUBMITTED,
      statusHistory: [{ from: null, to: STATUS.SUBMITTED, byName: 'system', note: 'Submitted online' }],
      submissionKey: submissionKey || undefined,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    if (err.keyPattern?.submissionKey) {
      return { registration: await Registration.findOne({ submissionKey }), created: false };
    }
    throw DUPLICATE();
  }

  // The registrant does not wait for WhatsApp. The outcome is recorded on the
  // notification and shown to admins, who can retry a failure.
  const acknowledgement = notifications
    .statusMessage(registration, TEMPLATE.SUBMITTED, null)
    .catch((err) => console.error('[registrations] acknowledgement failed:', err.message));

  return { registration, created: true, acknowledgement };
}

async function findOr404(id) {
  const registration = await Registration.findById(id);
  if (!registration) throw new HttpError(404, 'Registration not found.');
  return registration;
}

async function recordPassSend(registration, result) {
  const accepted = result.ok && result.notification?.status === 'accepted';
  const update = accepted
    ? { passStatus: PASS_STATUS.SENT, passSentAt: result.notification.acceptedAt }
    : { passStatus: PASS_STATUS.SEND_FAILED };
  // Never downgrade a pass that was already sent because a later resend failed.
  const filter = accepted ? { _id: registration._id } : { _id: registration._id, passStatus: { $ne: PASS_STATUS.SENT } };
  await Registration.updateOne(filter, { $set: update });
}

async function generateAndSendPass(registration, actor, result) {
  try {
    result.pass = await passes.issue(registration, actor);
  } catch (err) {
    console.error('[registrations] pass generation failed:', err);
    result.passError = 'The entry pass could not be generated. Use "Generate pass" to try again.';
    return result;
  }
  const sent = await notifications.sendPass(registration, result.pass, actor);
  await recordPassSend(registration, sent);
  result.messages.push(summarize(sent));
  return result;
}

/**
 * Applies a workflow action. The current status is part of the update filter,
 * so a double click or two admins acting at once cannot apply the same
 * transition twice (and therefore cannot send its message twice).
 */
async function transition(id, action, actor, note = '') {
  const rule = TRANSITIONS[action];
  if (!rule) throw new HttpError(404, 'Unknown action.');

  const current = await findOr404(id);
  if (!rule.from.includes(current.status)) {
    throw new HttpError(409, `This registration is already ${current.status}.`, { code: 'invalid_transition' });
  }

  const now = new Date();
  const set = { status: rule.to, statusChangedAt: now };
  if (rule.to === STATUS.CONFIRMED) Object.assign(set, { confirmedAt: now, confirmedBy: actor.id, confirmedByName: actor.name });

  const registration = await Registration.findOneAndUpdate(
    { _id: id, status: current.status },
    {
      $set: set,
      $push: { statusHistory: { from: current.status, to: rule.to, by: actor.id, byName: actor.name, note } },
    },
    { new: true }
  );
  if (!registration) {
    throw new HttpError(409, 'This registration was just updated by someone else. Refresh and try again.', {
      code: 'conflict',
    });
  }

  const result = { registration, messages: [], pass: null };

  if (rule.to === STATUS.CONFIRMED) {
    // The confirmation is saved first; the pass is generated only after that.
    result.messages.push(summarize(await notifications.statusMessage(registration, TEMPLATE.CONFIRMED, actor)));
    await generateAndSendPass(registration, actor, result);
  }

  return result;
}

/** Recovery when generation failed after confirmation. */
async function generatePass(id, actor) {
  const registration = await findOr404(id);
  if (registration.status !== STATUS.CONFIRMED) {
    throw new HttpError(409, 'An entry pass can only be generated after the registration is confirmed.');
  }
  if (await EntryPass.exists({ registration: registration._id, status: 'active' })) {
    throw new HttpError(409, 'This registration already has an entry pass. Use "Resend pass" to send it again.');
  }
  return generateAndSendPass(registration, actor, { registration, messages: [], pass: null });
}

async function resendPass(id, actor) {
  const registration = await findOr404(id);
  if (registration.status !== STATUS.CONFIRMED) {
    throw new HttpError(409, 'Only confirmed registrations have an entry pass.');
  }
  const pass = await EntryPass.findOne({ registration: registration._id, status: 'active' });
  if (!pass) throw new HttpError(409, 'No entry pass has been generated yet.');

  const last = await notifications.lastMessage(registration._id, TEMPLATE.PASS);
  if (last && last.status !== 'failed') {
    const age = Date.now() - last.createdAt.getTime();
    if (age < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - age) / 1000);
      throw new HttpError(429, `The pass was sent moments ago. Wait ${wait} seconds before sending it again.`);
    }
  }
  const sent = await notifications.sendPass(registration, pass, actor);
  await recordPassSend(registration, sent);
  return { registration, pass, messages: [summarize(sent)] };
}

// The statuses in which a failed message still makes sense to retry.
const RETRY_ALLOWED_IN = {
  [TEMPLATE.SUBMITTED]: [STATUS.SUBMITTED, STATUS.CONFIRMED],
  [TEMPLATE.CONFIRMED]: [STATUS.CONFIRMED],
  [TEMPLATE.PASS]: [STATUS.CONFIRMED],
};

async function retryNotification(id, notificationId, actor) {
  const registration = await findOr404(id);
  const record = await Notification.findOne({ _id: notificationId, registration: registration._id });
  if (!record) throw new HttpError(404, 'Message not found.');
  if (record.status === 'accepted') throw new HttpError(409, 'This message was already accepted by DXing.');
  if (!RETRY_ALLOWED_IN[record.template]?.includes(registration.status)) {
    throw new HttpError(409, `This message no longer applies: the registration is now ${registration.status}.`);
  }
  const result = await notifications.retry(record._id, registration, actor);
  if (!result) throw new HttpError(409, 'This message is being sent right now.');
  if (record.template === TEMPLATE.PASS) await recordPassSend(registration, result);
  return { registration, messages: [summarize(result)] };
}

module.exports = { submit, transition, generatePass, resendPass, retryNotification, findOr404 };
