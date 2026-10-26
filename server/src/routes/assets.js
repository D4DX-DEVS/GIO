// Public website images. The file name is the SHA-256 of the image, so the
// URL changes whenever the image changes and the response can be cached for a
// long time.
const express = require('express');
const { asyncHandler } = require('../utils/httpError');
const assets = require('../services/assets');

const router = express.Router();

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const found = await assets.file(req.params.key);
    if (!found) return res.status(404).json({ error: 'Not found' });
    res.set({
      'Content-Type': found.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
    });
    return res.send(found.buffer);
  })
);

module.exports = router;
