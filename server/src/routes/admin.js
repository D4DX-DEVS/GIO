const express = require('express');
const mongoose = require('mongoose');
const { Registration, EntryPass } = require('../models');
const { PASS_STATUS } = require('../config/constants');
const { asyncHandler, HttpError } = require('../utils/httpError');
const { requireAuth, requirePermission, requireCsrfHeader, can } = require('../middleware/auth');
const { parseListQuery } = require('../services/validation');
const registrations = require('../services/registrations');
const passes = require('../services/passes');
const photos = require('../services/photos');
const { formatForDisplay } = require('../utils/phone');
const { districts: districtList } = require('../config/districts');

const router = express.Router();
router.use(requireCsrfHeader, requireAuth);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactCI = (s) => new RegExp(`^${escapeRegex(s)}$`, 'i');

function checkId(...ids) {
  for (const id of ids) {
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id.');
  }
}

function listItem(r) {
  return {
    id: r._id,
    regNo: r.regNo,
    name: r.name,
    age: r.age,
    mobile: r.mobile,
    mobileDisplay: formatForDisplay(r.mobile),
    email: r.email,
    district: r.district,
    area: r.area,
    unit: r.unit,
    // Fields from the new form. null = not recorded (older registrations).
    formVersion: r.formVersion ?? 1,
    gender: r.gender ?? null,
    place: r.place ?? null,
    // The registrant's photo on the Spaces CDN; null for older registrations.
    photoUrl: photos.url(r.photo),
    whatsapp: r.whatsapp ?? null,
    whatsappDisplay: r.whatsapp ? formatForDisplay(r.whatsapp) : null,
    childrenCount: Array.isArray(r.children) ? r.children.length : null,
    status: r.status,
    passId: r.passId,
    // Every status other than not_generated means the pass exists.
    hasPass: r.passStatus !== PASS_STATUS.NONE,
    passGeneratedAt: r.passGeneratedAt,
    createdAt: r.createdAt,
  };
}

function passView(pass, registrationId) {
  if (!pass) return null;
  const route = `/api/admin/registrations/${registrationId}/pass.png?v=${pass.version}`;
  return {
    passId: pass.passId,
    version: pass.version,
    status: pass.status,
    holder: pass.holder,
    issuedAt: pass.issuedAt,
    // The admin route redirects to the image on the Spaces CDN (storing it
    // first for passes issued before images were kept there).
    imageUrl: pass.status === 'active' ? route : null,
    downloadUrl: pass.status === 'active' ? `${route}&download=1` : null,
  };
}

async function detail(registrationId, admin) {
  const [registration, pass] = await Promise.all([Registration.findById(registrationId), EntryPass.findOne({ registration: registrationId })]);
  if (!registration) throw new HttpError(404, 'Registration not found.');
  return {
    registration: {
      ...listItem(registration),
      // Children's names and ages are for admins only; the pass prints only the number.
      children:
        can(admin, 'approve') && Array.isArray(registration.children)
          ? registration.children.map((c) => ({ name: c.name ?? null, age: c.age }))
          : null,
      statusHistory: registration.statusHistory,
      updatedAt: registration.updatedAt,
    },
    pass: passView(pass, registration._id),
  };
}

function permissionsFor(admin) {
  return {
    send: can(admin, 'send'),
    gate: can(admin, 'gate'),
  };
}

// --- Listing ---------------------------------------------------------------

router.get(
  '/registrations',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    const q = parseListQuery(req.query);
    const filter = {};
    if (q.district) filter.district = exactCI(q.district);
    if (q.area) filter.area = exactCI(q.area);
    if (q.unit) filter.unit = exactCI(q.unit);
    if (q.pass === 'issued') filter.passStatus = { $ne: PASS_STATUS.NONE };
    if (q.pass === 'missing') filter.passStatus = PASS_STATUS.NONE;
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(q.from);
      if (q.to) filter.createdAt.$lte = new Date(q.to);
    }
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), 'i');
      const or = [{ name: rx }, { email: rx }, { regNo: rx }, { passId: rx }, { area: rx }, { unit: rx }, { place: rx }];
      const digits = q.search.replace(/\D/g, '');
      if (digits.length >= 3) or.push({ mobile: new RegExp(escapeRegex(digits)) }, { whatsapp: new RegExp(escapeRegex(digits)) });
      filter.$or = or;
    }

    const dir = q.dir === 'asc' ? 1 : -1;
    const SORTS = {
      createdAt: { createdAt: dir, _id: dir },
      name: { nameKey: dir, _id: dir },
      age: { age: dir, createdAt: -1 },
      district: { district: dir, nameKey: 1 },
    };
    const sort = SORTS[q.sort];

    const [items, total] = await Promise.all([
      Registration.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Registration.countDocuments(filter),
    ]);
    res.json({ items: items.map(listItem), total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) });
  })
);

router.get(
  '/stats',
  requirePermission('view'),
  asyncHandler(async (_req, res) => {
    const [row] = await Registration.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withoutPass: { $sum: { $cond: [{ $eq: ['$passStatus', PASS_STATUS.NONE] }, 1, 0] } },
          children: { $sum: { $size: { $ifNull: ['$children', []] } } },
        },
      },
    ]);
    const total = row?.total ?? 0;
    const withoutPass = row?.withoutPass ?? 0;
    res.json({ total, passesIssued: total - withoutPass, withoutPass, children: row?.children ?? 0 });
  })
);

// District options are the form's district list only; area and unit options
// come from submitted data.
router.get(
  '/filters',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    const district = typeof req.query.district === 'string' ? req.query.district.trim() : '';
    const area = typeof req.query.area === 'string' ? req.query.area.trim() : '';
    const distinct = async (field, match) => {
      const rows = await Registration.aggregate([
        { $match: match },
        { $group: { _id: { $toLower: `$${field}` }, label: { $first: `$${field}` } } },
        { $sort: { _id: 1 } },
        { $limit: 500 },
      ]);
      return rows.map((r) => r.label);
    };
    const areaMatch = district ? { district: exactCI(district) } : {};
    const unitMatch = { ...areaMatch, ...(area ? { area: exactCI(area) } : {}) };
    const [areas, units] = await Promise.all([
      distinct('area', areaMatch),
      distinct('unit', unitMatch),
    ]);
    res.json({ districts: districtList(), areas, units });
  })
);

router.get(
  '/registrations/:id',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    res.json({ ...(await detail(req.params.id, req.admin)), permissions: permissionsFor(req.admin) });
  })
);

// --- Entry pass ----------------------------------------------------------------

// Passes are generated at submission. This is for a registration without one
// (generation failed and the registrant left, or it predates automatic passes).
router.post(
  '/registrations/:id/pass/generate',
  requirePermission('send'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    await registrations.generatePass(req.params.id, req.actor);
    res.json({ ...(await detail(req.params.id, req.admin)), permissions: permissionsFor(req.admin) });
  })
);

// Viewing redirects to the image on the Spaces CDN; ?download=1 sends the
// file from this origin with a download file name (a cross-origin link
// cannot set one).
router.get(
  '/registrations/:id/pass.png',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    const found = await EntryPass.findOne({ registration: req.params.id, status: 'active' });
    if (!found) throw new HttpError(404, 'No active entry pass.');
    if (req.query.download !== '1') {
      const pass = await passes.storeImage(found);
      res.set('Cache-Control', 'private, no-store');
      return res.redirect(302, passes.imageUrl(pass));
    }
    const { pass, png } = await passes.imageFile(found);
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="entry-pass-${pass.passId}.png"`,
    });
    return res.send(png);
  })
);

// --- Gate --------------------------------------------------------------------

const VERIFY_MESSAGES = {
  invalid_code: 'Not a valid pass code.',
  not_found: 'No pass with this ID.',
  outdated: 'This QR code belongs to an older version of the pass.',
  revoked: 'This pass has been cancelled.',
  not_confirmed: 'The registration for this pass is not confirmed.',
};

router.post(
  '/passes/verify',
  requirePermission('gate'),
  asyncHandler(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 200) : '';
    const result = await passes.verify(code);
    if (!result.valid) {
      return res.json({ valid: false, reason: result.reason, message: VERIFY_MESSAGES[result.reason] });
    }
    const { pass, registration } = result;
    return res.json({
      valid: true,
      signed: result.signed,
      pass: passView(pass, registration._id),
      registration: listItem(registration),
    });
  })
);

module.exports = router;
