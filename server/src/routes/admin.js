const express = require('express');
const mongoose = require('mongoose');
const { Registration, EntryPass } = require('../models');
const { PASS_STATUS, AGE_GROUPS } = require('../config/constants');
const { asyncHandler, HttpError } = require('../utils/httpError');
const { requireAuth, requirePermission, requireCsrfHeader, can } = require('../middleware/auth');
const { parseListQuery, parseAttendanceQuery } = require('../services/validation');
const registrations = require('../services/registrations');
const attendance = require('../services/attendance');
const passes = require('../services/passes');
const photos = require('../services/photos');
const site = require('../services/site');
const exportFiles = require('../services/exports');
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
    // Event day attendance; null = not yet.
    checkedInAt: r.checkedInAt ?? null,
    checkedInByName: r.checkedInByName || null,
    checkedOutAt: r.checkedOutAt ?? null,
    checkedOutByName: r.checkedOutByName || null,
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

function ageRange(key) {
  const [min, max] = AGE_GROUPS[key];
  return max === null ? { $gte: min } : { $gte: min, $lte: max };
}

// The list query (search and filters) as a MongoDB filter; shared by the list and the export.
function listFilter(q) {
  const filter = {};
  if (q.district) filter.district = exactCI(q.district);
  if (q.area) filter.area = exactCI(q.area);
  if (q.unit) filter.unit = exactCI(q.unit);
  if (q.pass === 'issued') filter.passStatus = { $ne: PASS_STATUS.NONE };
  if (q.pass === 'missing') filter.passStatus = PASS_STATUS.NONE;
  // "without" includes older registrations where children were not recorded.
  if (q.children === 'with') filter['children.0'] = { $exists: true };
  if (q.children === 'without') filter['children.0'] = { $exists: false };
  if (q.age) filter.age = ageRange(q.age);
  if (q.childAge) filter.children = { $elemMatch: { age: ageRange(q.childAge) } };
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
  return filter;
}

function listSort(q) {
  const dir = q.dir === 'asc' ? 1 : -1;
  const SORTS = {
    createdAt: { createdAt: dir, _id: dir },
    name: { nameKey: dir, _id: dir },
    age: { age: dir, createdAt: -1 },
    district: { district: dir, nameKey: 1 },
  };
  return SORTS[q.sort];
}

router.get(
  '/registrations',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    const q = parseListQuery(req.query);
    const filter = listFilter(q);
    const [items, total] = await Promise.all([
      Registration.find(filter).sort(listSort(q)).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Registration.countDocuments(filter),
    ]);
    res.json({ items: items.map(listItem), total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) });
  })
);

// --- Export --------------------------------------------------------------------

const EXPORT_MAX = 10000;
const EXPORT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
const EXPORT_FIELDS =
  'regNo name age gender mobile whatsapp email district area unit place children passStatus passId createdAt checkedInAt checkedInByName checkedOutAt checkedOutByName';

// Every registration the list shows for the same search, filters and sort
// (all pages, not just the one on screen), as an Excel workbook or a PDF.
// `tz` is the admin's time zone, for the dates in the file.
router.get(
  '/registrations/export',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    const { format } = req.query;
    if (typeof format !== 'string' || !Object.hasOwn(EXPORT_TYPES, format)) throw new HttpError(400, 'Choose Excel or PDF.');
    const q = parseListQuery(req.query);
    const timeZone = exportFiles.timeZoneOf(req.query.tz);
    const filter = listFilter(q);
    if ((await Registration.countDocuments(filter)) > EXPORT_MAX) {
      throw new HttpError(400, `Export at most ${EXPORT_MAX} registrations at a time. Add a filter to narrow the list.`);
    }
    const docs = await Registration.find(filter).sort(listSort(q)).select(EXPORT_FIELDS).lean();
    const file =
      format === 'xlsx'
        ? await exportFiles.xlsx(docs, { timeZone, withChildren: can(req.admin, 'approve') })
        : exportFiles.pdf(docs, { timeZone, summary: exportFiles.describeFilters(q, timeZone), event: (await site.getEvent()).name });
    res.set({
      'Content-Type': EXPORT_TYPES[format],
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="registrations-${exportFiles.isoDay(new Date(), timeZone)}.${format}"`,
    });
    res.send(file);
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

// --- Deleting ------------------------------------------------------------------

// 500 ids stay well inside the 20 KB JSON body limit.
const DELETE_MAX = 500;

// Permanently deletes the selected registrations (for example test data) with
// their passes, pass images and photos.
router.post(
  '/registrations/delete',
  requirePermission('delete'),
  asyncHandler(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, 'Select at least one registration to delete.');
    if (ids.length > DELETE_MAX) throw new HttpError(400, `Delete at most ${DELETE_MAX} registrations at a time.`);
    if (!ids.every((id) => typeof id === 'string' && mongoose.isObjectIdOrHexString(id))) throw new HttpError(400, 'Invalid id.');
    res.json(await registrations.removeMany([...new Set(ids)], req.actor));
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

// --- Check-in and check-out -----------------------------------------------------

function attendanceFilter(q) {
  const filter = listFilter(q);
  if (q.type === 'out') {
    filter.checkedOutAt = { $ne: null };
  } else {
    filter.checkedInAt = { $ne: null };
    if (q.state === 'inside') filter.checkedOutAt = null;
    if (q.state === 'left') filter.checkedOutAt = { $ne: null };
  }
  return filter;
}

function attendanceSort(q) {
  if (q.sort !== 'time') return listSort(q);
  const dir = q.dir === 'asc' ? 1 : -1;
  return { [q.type === 'out' ? 'checkedOutAt' : 'checkedInAt']: dir, _id: dir };
}

const actionOf = (body) => {
  const action = body?.action;
  if (!attendance.ACTIONS.includes(action)) throw new HttpError(400, 'Choose check-in or check-out.');
  return action;
};

// Records a check-in or check-out from a scanned QR code or a typed pass ID.
// Every outcome is a 200 with `result`: ok, already (with the earlier time on
// the registration), not_checked_in, or invalid (with the reason).
router.post(
  '/attendance/scan',
  requirePermission('gate'),
  asyncHandler(async (req, res) => {
    const action = actionOf(req.body);
    const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 200) : '';
    const out = await attendance.scan(code, action, req.actor);
    if (out.result === 'invalid') return res.json({ result: 'invalid', action, reason: out.reason, message: VERIFY_MESSAGES[out.reason] });
    return res.json({ result: out.result, action, registration: listItem(out.registration) });
  })
);

router.get(
  '/attendance/stats',
  requirePermission('view'),
  asyncHandler(async (_req, res) => {
    res.json(await attendance.stats());
  })
);

router.get(
  '/attendance',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    const q = parseAttendanceQuery(req.query);
    const filter = attendanceFilter(q);
    const [items, total] = await Promise.all([
      Registration.find(filter).sort(attendanceSort(q)).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Registration.countDocuments(filter),
    ]);
    res.json({ items: items.map(listItem), total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) });
  })
);

// The check-in or check-out list (all pages) as Excel or PDF, like the registration export.
router.get(
  '/attendance/export',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    const { format } = req.query;
    if (typeof format !== 'string' || !Object.hasOwn(EXPORT_TYPES, format)) throw new HttpError(400, 'Choose Excel or PDF.');
    const q = parseAttendanceQuery(req.query);
    const timeZone = exportFiles.timeZoneOf(req.query.tz);
    const filter = attendanceFilter(q);
    if ((await Registration.countDocuments(filter)) > EXPORT_MAX) {
      throw new HttpError(400, `Export at most ${EXPORT_MAX} people at a time. Add a filter to narrow the list.`);
    }
    const docs = await Registration.find(filter).sort(attendanceSort(q)).select(EXPORT_FIELDS).lean();
    const file =
      format === 'xlsx'
        ? await exportFiles.xlsx(docs, { timeZone, withChildren: can(req.admin, 'approve'), attendance: q.type })
        : exportFiles.pdf(docs, { timeZone, summary: exportFiles.describeFilters(q, timeZone), event: (await site.getEvent()).name, attendance: q.type });
    res.set({
      'Content-Type': EXPORT_TYPES[format],
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="check-${q.type}s-${exportFiles.isoDay(new Date(), timeZone)}.${format}"`,
    });
    res.send(file);
  })
);

// Admin correction of a wrong scan; the pass can then be scanned again.
router.post(
  '/attendance/:id/undo',
  requirePermission('approve'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    const registration = await attendance.undo(req.params.id, actionOf(req.body), req.actor);
    res.json({ registration: listItem(registration) });
  })
);

module.exports = router;
