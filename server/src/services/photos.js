// Registrants' photos. The form uploads the photo as soon as it is chosen;
// it is checked and re-encoded like website images (services/assets.js:
// type from the bytes, size limits, EXIF and GPS data removed), stored in
// DigitalOcean Spaces, and the submission then refers to it by its key. The
// photo is printed on the entry pass.
const { HttpError } = require('../utils/httpError');
const store = require('../providers/assetStore');
const { processImage } = require('./assets');

// Big enough for the pass and the admin page; keeps each photo small.
const MAX_EDGE = 900;

async function upload(buffer) {
  let img;
  try {
    img = await processImage(buffer, { maxEdge: MAX_EDGE, jpeg: true });
  } catch (err) {
    // Same checks as website images, worded for a registrant.
    if (err.code === 'unsupported_type') throw new HttpError(415, 'Choose a JPG or PNG photo.', { code: 'unsupported_type' });
    throw err;
  }
  const key = store.photos.newKey();
  await store.photos.put(key, img.buffer);
  return { photo: key, url: store.photos.url(key), width: img.width, height: img.height };
}

/** Whether the key names a photo that was uploaded. */
async function exists(key) {
  return typeof key === 'string' && store.photos.KEY_RE.test(key) && store.photos.exists(key);
}

const url = (key) => (key && store.photos.KEY_RE.test(key) ? store.photos.url(key) : null);

module.exports = { upload, exists, url };
