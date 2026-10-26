const express = require('express');
const mongoose = require('mongoose');
const { Registration, EntryPass, Notification } = require('../models');
const { STATUS, STATUSES, PASS_STATUS, PASS_STATUSES, TRANSITIONS } = require('../config/constants');
const { asyncHandler, HttpError } = require('../utils/httpError');
const { requireAuth, requirePermission, requireCsrfHeader, can } = require('../middleware/auth');
const { parseListQuery, parseNote } = require('../services/validation');
const registrations = require('../services/registrations');
const passes = require('../services/passes');
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
    status: r.status,
    statusChangedAt: r.statusChangedAt,
    confirmedAt: r.confirmedAt || null,
    confirmedByName: r.confirmedByName || null,
    passId: r.passId,
    passStatus: r.passStatus,
    passGeneratedAt: r.passGeneratedAt,
    passSentAt: r.passSentAt,
    createdAt: r.createdAt,
  };
}

function passView(pass, registrationId) {
  if (!pass) return null;
  return {
    passId: pass.passId,
    version: pass.version,
    status: pass.status,
    holder: pass.holder,
    issuedAt: pass.issuedAt,
    // Served through the authenticated admin route, never a public URL.
    imageUrl: pass.status === 'active' ? `/api/admin/registrations/${registrationId}/pass.png?v=${pass.version}` : null,
  };
}

function notificationView(n) {
  return {
    id: n._id,
    template: n.template,
    status: n.status,
    attempts: n.attempts,
    lastError: n.lastError || null,
    triggeredByName: n.triggeredByName,
    acceptedAt: n.acceptedAt || null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

async function detail(registrationId) {
  const [registration, pass, messages] = await Promise.all([
    Registration.findById(registrationId),
    EntryPass.findOne({ registration: registrationId }),
    Notification.find({ registration: registrationId }).sort({ createdAt: -1 }).limit(50),
  ]);
  if (!registration) throw new HttpError(404, 'Registration not found.');
  return {
    registration: { ...listItem(registration), statusHistory: registration.statusHistory, updatedAt: registration.updatedAt },
    pass: passView(pass, registration._id),
    notifications: messages.map(notificationView),
  };
}

function actionResponse(req, result) {
  return detail(result.registration._id).then((d) => ({
    ...d,
    messages: result.messages || [],
    passError: result.passError || null,
    permissions: permissionsFor(req.admin),
  }));
}

function permissionsFor(admin) {
  return {
    approve: can(admin, 'approve'),
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
    if (q.status) filter.status = q.status;
    if (q.district) filter.district = exactCI(q.district);
    if (q.area) filter.area = exactCI(q.area);
    if (q.unit) filter.unit = exactCI(q.unit);
    if (q.passStatus) filter.passStatus = q.passStatus;
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(q.from);
      if (q.to) filter.createdAt.$lte = new Date(q.to);
    }
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), 'i');
      const or = [{ name: rx }, { email: rx }, { regNo: rx }, { passId: rx }, { area: rx }, { unit: rx }];
      const digits = q.search.replace(/\D/g, '');
      if (digits.length >= 3) or.push({ mobile: new RegExp(escapeRegex(digits)) });
      filter.$or = or;
    }

    const dir = q.dir === 'asc' ? 1 : -1;
    const SORTS = {
      createdAt: { createdAt: dir, _id: dir },
      name: { nameKey: dir, _id: dir },
      age: { age: dir, createdAt: -1 },
      district: { district: dir, nameKey: 1 },
      // Workflow order rather than alphabetical.
      status: { statusRank: dir, createdAt: -1 },
    };
    const sort = SORTS[q.sort];

    const [items, total] = await Promise.all([
      q.sort === 'status'
        ? Registration.aggregate([
            { $match: filter },
            { $addFields: { statusRank: { $indexOfArray: [STATUSES, '$status'] } } },
            { $sort: sort },
            { $skip: (q.page - 1) * q.limit },
            { $limit: q.limit },
          ])
        : Registration.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Registration.countDocuments(filter),
    ]);
    res.json({ items: items.map(listItem), total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) });
  })
);

router.get(
  '/stats',
  requirePermission('view'),
  asyncHandler(async (_req, res) => {
    const [rows, passRows, failedMessages] = await Promise.all([
      Registration.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Registration.aggregate([{ $group: { _id: '$passStatus', n: { $sum: 1 } } }]),
      Notification.countDocuments({ status: 'failed' }),
    ]);
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of rows) if (r._id in byStatus) byStatus[r._id] = r.n;
    const byPassStatus = Object.fromEntries(PASS_STATUSES.map((s) => [s, 0]));
    for (const r of passRows) if (r._id in byPassStatus) byPassStatus[r._id] = r.n;
    res.json({
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      // "Awaiting confirmation" is the dashboard label for Submitted.
      awaitingConfirmation: byStatus[STATUS.SUBMITTED],
      confirmed: byStatus[STATUS.CONFIRMED],
      passesSent: byPassStatus[PASS_STATUS.SENT],
      passSendFailed: byPassStatus[PASS_STATUS.SEND_FAILED],
      byStatus,
      byPassStatus,
      failedMessages,
    });
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
    res.json({ districts: districtList(), areas, units, statuses: STATUSES, passStatuses: PASS_STATUSES });
  })
);

router.get(
  '/registrations/:id',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    res.json({ ...(await detail(req.params.id)), permissions: permissionsFor(req.admin) });
  })
);

// --- Workflow ----------------------------------------------------------------

// Permission depends on the action (only admins confirm).
function requireActionPermission(req, res, next) {
  const rule = TRANSITIONS[req.params.action];
  if (!rule) return next(new HttpError(404, 'Unknown action.'));
  return requirePermission(rule.permission)(req, res, next);
}

router.post(
  '/registrations/:id/actions/:action',
  requireActionPermission,
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    const note = parseNote(req.body);
    const result = await registrations.transition(req.params.id, req.params.action, req.actor, note);
    res.json(await actionResponse(req, result));
  })
);

router.post(
  '/registrations/:id/pass/generate',
  requirePermission('send'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    res.json(await actionResponse(req, await registrations.generatePass(req.params.id, req.actor)));
  })
);

router.post(
  '/registrations/:id/pass/resend',
  requirePermission('send'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    res.json(await actionResponse(req, await registrations.resendPass(req.params.id, req.actor)));
  })
);

router.post(
  '/registrations/:id/notifications/:nid/retry',
  requirePermission('send'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id, req.params.nid);
    res.json(await actionResponse(req, await registrations.retryNotification(req.params.id, req.params.nid, req.actor)));
  })
);

router.get(
  '/registrations/:id/pass.png',
  requirePermission('view'),
  asyncHandler(async (req, res) => {
    checkId(req.params.id);
    const pass = await EntryPass.findOne({ registration: req.params.id, status: 'active' });
    if (!pass) throw new HttpError(404, 'No active entry pass.');
    const png = await passes.render(pass);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${disposition}; filename="entry-pass-${pass.passId}.png"`,
    });
    res.send(png);
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
