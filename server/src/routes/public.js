const express = require('express');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { AGE_MIN, AGE_MAX, FORM_VERSION, PLACE_REQUIRED } = require('../config/constants');
const { childrenEnabled } = require('../config/siteSchema');
const { districts } = require('../config/districts');
const { COUNTRIES } = require('../config/countries');
const { asyncHandler, HttpError } = require('../utils/httpError');
const { parseRegistration } = require('../services/validation');
const registrations = require('../services/registrations');
const site = require('../services/site');

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isProduction ? 30 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registrations from this network. Please try again later.' },
});

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const [event, form, registrationOpen] = await Promise.all([site.getEvent(), site.getFormRules(), site.isRegistrationOpen()]);
    res.set('Cache-Control', 'no-cache');
    res.json({
      eventName: event.name,
      eventDate: event.date,
      eventVenue: event.venue,
      supportContact: event.supportContact,
      registrationOpen,
      ageMin: AGE_MIN,
      ageMax: AGE_MAX,
      districts: districts(),
      defaultCountryCode: env.defaultCountryCode,
      countries: COUNTRIES,
      formVersion: FORM_VERSION,
      placeRequired: PLACE_REQUIRED,
      // Empty until an admin sets them; the form then leaves the question out.
      genderOptions: form.genderOptions,
      children: childrenEnabled(form) ? { max: form.childrenMax, ageMin: form.childAgeMin, ageMax: form.childAgeMax } : null,
    });
  })
);

// Published website content only. Drafts are served to admins through
// /api/admin/website/preview.
router.get(
  '/site',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    const content = await site.buildSite('published');
    if (!content) return res.status(404).json({ error: 'The website has not been published yet.', code: 'not_published' });
    return res.json(content);
  })
);

router.post(
  '/registrations',
  submitLimiter,
  asyncHandler(async (req, res) => {
    if (!(await site.isRegistrationOpen())) throw new HttpError(403, 'Registrations are currently closed.');

    const key = req.get('Idempotency-Key');
    if (key !== undefined && !/^[A-Za-z0-9-]{16,64}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key.');

    const data = parseRegistration(req.body, await site.getFormRules());
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
