// Admin API for the conference website: page settings, programme, speakers,
// announcements, FAQs, gallery and the image library. Admins only (the
// "content" permission); staff get 403.
const express = require('express');
const { asyncHandler } = require('../utils/httpError');
const { requireAuth, requirePermission, requireCsrfHeader } = require('../middleware/auth');
const content = require('../services/siteContent');
const assets = require('../services/assets');
const site = require('../services/site');

const router = express.Router();
router.use(requireCsrfHeader, requireAuth, requirePermission('content'));

const body = (req) => req.body || {};

// --- Page settings -----------------------------------------------------------

router.get('/settings', asyncHandler(async (_req, res) => res.json(await content.getSettings())));

router.put(
  '/settings',
  asyncHandler(async (req, res) => res.json(await content.saveSettings(body(req).draft, body(req).version, req.actor)))
);

router.post(
  '/settings/publish',
  asyncHandler(async (req, res) => res.json(await content.publishSettings(body(req).version, req.actor)))
);

router.post(
  '/settings/discard',
  asyncHandler(async (req, res) => res.json(await content.discardSettings(body(req).version, req.actor)))
);

// What the website would look like with every draft published.
router.get(
  '/preview',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await site.buildSite('draft'));
  })
);

// --- Items -------------------------------------------------------------------

router.get('/items/:kind', asyncHandler(async (req, res) => res.json({ items: await content.listItems(req.params.kind) })));

router.post(
  '/items/:kind',
  asyncHandler(async (req, res) => res.status(201).json(await content.createItem(req.params.kind, body(req).data, req.actor)))
);

router.put(
  '/items/:kind/:id',
  asyncHandler(async (req, res) =>
    res.json(await content.updateItem(req.params.kind, req.params.id, body(req).data, body(req).version, req.actor))
  )
);

router.post(
  '/items/:kind/:id/publish',
  asyncHandler(async (req, res) => res.json(await content.publishItem(req.params.kind, req.params.id, body(req).version, req.actor)))
);

router.post(
  '/items/:kind/:id/unpublish',
  asyncHandler(async (req, res) => res.json(await content.unpublishItem(req.params.kind, req.params.id, body(req).version, req.actor)))
);

router.post(
  '/items/:kind/:id/move',
  asyncHandler(async (req, res) => res.json({ items: await content.moveItem(req.params.kind, req.params.id, body(req).direction) }))
);

router.delete('/items/:kind/:id', asyncHandler(async (req, res) => res.json(await content.deleteItem(req.params.kind, req.params.id))));

// --- Images ------------------------------------------------------------------

// The upload body is the image itself. Only these two routes accept more than
// the global 20 KB JSON limit; the type is decided from the bytes, not from
// Content-Type.
const rawImage = express.raw({ type: () => true, limit: assets.MAX_BYTES });

function fileName(req) {
  try {
    return decodeURIComponent(req.get('X-File-Name') || '').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 200);
  } catch {
    return '';
  }
}

router.get('/assets', asyncHandler(async (_req, res) => res.json({ assets: await assets.list() })));

router.post(
  '/assets',
  rawImage,
  asyncHandler(async (req, res) => {
    const input = { alt: req.query.alt, caption: req.query.caption, originalName: fileName(req) };
    res.status(201).json(await assets.upload(req.body, input, req.actor));
  })
);

router.post(
  '/assets/:id/replace',
  rawImage,
  asyncHandler(async (req, res) => res.json(await assets.replace(req.params.id, req.body, { originalName: fileName(req) }, req.actor)))
);

router.put('/assets/:id', asyncHandler(async (req, res) => res.json(await assets.updateMeta(req.params.id, body(req)))));

router.delete('/assets/:id', asyncHandler(async (req, res) => res.json(await assets.remove(req.params.id))));

module.exports = router;
