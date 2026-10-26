const express = require('express');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { AGE_MIN, AGE_MAX } = require('../config/constants');
const { districts } = require('../config/districts');
const { COUNTRIES } = require('../config/countries');
const { asyncHandler, HttpError } = require('../utils/httpError');
const { parseRegistration } = require('../services/validation');
const registrations = require('../services/registrations');

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isProduction ? 30 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registrations from this network. Please try again later.' },
});

router.get('/config', (_req, res) => {
  res.json({
    eventName: env.event.name,
    eventDate: env.event.date,
    eventVenue: env.event.venue,
    supportContact: env.event.supportContact,
    registrationOpen: env.registrationOpen,
    ageMin: AGE_MIN,
    ageMax: AGE_MAX,
    districts: districts(),
    defaultCountryCode: env.defaultCountryCode,
    countries: COUNTRIES,
  });
});

router.post(
  '/registrations',
  submitLimiter,
  asyncHandler(async (req, res) => {
    if (!env.registrationOpen) throw new HttpError(403, 'Registrations are currently closed.');

    const key = req.get('Idempotency-Key');
    if (key !== undefined && !/^[A-Za-z0-9-]{16,64}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key.');

    const data = parseRegistration(req.body);
    const { registration, created } = await registrations.submit(data, key);

    // Only what the registrant needs to see; no internal IDs.
    res.status(created ? 201 : 200).json({
      ok: true,
      regNo: registration.regNo,
      name: registration.name,
      message: 'Registration submitted successfully.',
    });
  })
);

module.exports = router;
