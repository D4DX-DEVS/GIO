// Signed, expiring link to a pass image, given to the registrant on the
// success page for "Download" and for sharing the image as a file. The image
// itself is stored in DigitalOcean Spaces; this route reads it from there so
// the browser gets it from this origin (the CDN sends no CORS headers).
const express = require('express');
const { EntryPass, Registration } = require('../models');
const { STATUS } = require('../config/constants');
const { asyncHandler } = require('../utils/httpError');
const { verifyImageLink } = require('../utils/passTokens');
const passes = require('../services/passes');

const router = express.Router();

router.get(
  '/:passId/image',
  asyncHandler(async (req, res) => {
    const link = verifyImageLink(req.params.passId, req.query);
    // Same response for every failure so the endpoint reveals nothing.
    const deny = () => res.status(404).json({ error: 'Not found' });
    if (!link) return deny();

    const found = await EntryPass.findOne({ passId: req.params.passId, status: 'active', version: link.version });
    if (!found) return deny();
    const registration = await Registration.findById(found.registration).select('status');
    if (registration?.status !== STATUS.CONFIRMED) return deny();

    const { pass, png } = await passes.imageFile(found);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'Content-Disposition': `${disposition}; filename="entry-pass-${pass.passId}.png"`,
    });
    return res.send(png);
  })
);

module.exports = router;
