// Registration business logic: submission and the entry pass that every
// registration gets as soon as it is submitted.
const { Registration, Counter } = require('../models');
const { STATUS } = require('../config/constants');
const { HttpError } = require('../utils/httpError');
const passes = require('./passes');

const nameKeyOf = (name) => name.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

const DUPLICATE = () =>
  new HttpError(409, 'A registration with this name and mobile number already exists.', { code: 'duplicate' });

/**
 * Generates the entry pass right after a submission is saved. When that
 * fails (for example Spaces is unreachable), the registration is kept and
 * the registrant is asked to press Submit again: the same Idempotency-Key
 * returns this registration and tries the pass again.
 */
async function issueForRegistrant(registration) {
  try {
    return await passes.issue(registration);
  } catch (err) {
    console.error(`[registrations] entry pass for ${registration.regNo} failed:`, err);
    throw new HttpError(
      503,
      `Your registration ${registration.regNo} is saved, but your entry pass could not be created just now. Please press Submit again in a moment.`,
      { code: 'pass_failed' }
    );
  }
}

/**
 * Public submission. Returns { registration, pass, created }. The
 * registration is confirmed automatically and its entry pass generated.
 * `created` is false when the same submission key was already processed
 * (double tap, network retry); nothing new is saved and the existing pass is
 * returned.
 */
async function submit(data, submissionKey) {
  if (submissionKey) {
    const previous = await Registration.findOne({ submissionKey });
    if (previous) return { registration: previous, pass: await issueForRegistrant(previous), created: false };
  }

  const nameKey = nameKeyOf(data.name);
  if (await Registration.exists({ mobile: data.mobile, nameKey })) throw DUPLICATE();

  const seq = await Counter.next('registration');
  const now = new Date();
  let registration;
  try {
    registration = await Registration.create({
      ...data,
      nameKey,
      regNo: `REG-${String(seq).padStart(5, '0')}`,
      status: STATUS.CONFIRMED,
      statusChangedAt: now,
      confirmedAt: now,
      confirmedByName: 'system',
      statusHistory: [{ from: null, to: STATUS.CONFIRMED, byName: 'system', note: 'Submitted online and confirmed automatically', at: now }],
      submissionKey: submissionKey || undefined,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    if (err.keyPattern?.submissionKey) {
      const previous = await Registration.findOne({ submissionKey });
      return { registration: previous, pass: await issueForRegistrant(previous), created: false };
    }
    throw DUPLICATE();
  }

  return { registration, pass: await issueForRegistrant(registration), created: true };
}

async function findOr404(id) {
  const registration = await Registration.findById(id);
  if (!registration) throw new HttpError(404, 'Registration not found.');
  return registration;
}

/**
 * Admin recovery: generates the pass of a registration that has none, either
 * because the registrant left after pass generation failed, or because it
 * was submitted before passes were generated automatically (it is confirmed
 * first).
 */
async function generatePass(id, actor) {
  let registration = await findOr404(id);
  if (registration.status === STATUS.SUBMITTED) {
    const now = new Date();
    registration =
      (await Registration.findOneAndUpdate(
        { _id: id, status: STATUS.SUBMITTED },
        {
          $set: { status: STATUS.CONFIRMED, statusChangedAt: now, confirmedAt: now, confirmedBy: actor.id, confirmedByName: actor.name },
          $push: { statusHistory: { from: STATUS.SUBMITTED, to: STATUS.CONFIRMED, by: actor.id, byName: actor.name, note: 'Confirmed when the entry pass was generated', at: now } },
        },
        { new: true }
      )) ?? (await findOr404(id));
  }
  try {
    await passes.issue(registration, actor);
  } catch (err) {
    console.error(`[registrations] entry pass for ${registration.regNo} failed:`, err);
    throw new HttpError(503, 'The entry pass could not be generated. Check the file storage settings and try again.', { code: 'pass_failed' });
  }
  return { registration: await findOr404(id) };
}

module.exports = { submit, generatePass, findOr404 };
