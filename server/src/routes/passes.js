// Signed, expiring link to a pass image. This is the URL handed to DXing; it
// is not guessable and stops working after PASS_IMAGE_LINK_MINUTES.
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

    const pass = await EntryPass.findOne({ passId: req.params.passId, status: 'active', version: link.version });
    if (!pass) return deny();
    const registration = await Registration.findById(pass.registration).select('status');
    if (registration?.status !== STATUS.CONFIRMED) return deny();

    const png = await passes.render(pass);
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'Content-Disposition': `inline; filename="entry-pass-${pass.passId}.png"`,
    });
    return res.send(png);
  })
);

module.exports = router;
