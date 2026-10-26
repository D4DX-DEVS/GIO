// Website images: upload checks, re-encoding and the image library.
//
// Every upload is checked from its bytes (never the file name or the
// Content-Type the browser sent), its dimensions are read from the header
// before decoding, and it is re-drawn with `canvas` and re-encoded. That
// removes EXIF data such as the GPS position in phone photos, applies the
// EXIF rotation, and makes sure what is stored is a plain JPEG or PNG.
const crypto = require('crypto');
const mongoose = require('mongoose');
const { createCanvas, loadImage } = require('canvas');
const { Asset } = require('../models');
const { HttpError } = require('../utils/httpError');
const store = require('../providers/assetStore');
const { usageMap } = require('./siteContent');
const { imageView } = require('./site');

const MAX_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 200;
const MAX_EDGE = 1600;
// Refuse before decoding: a small file can declare a huge image.
const MAX_PIXELS = 40 * 1000 * 1000;

// --- Header parsing ----------------------------------------------------------

function pngInfo(b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 24 || !b.subarray(0, 8).equals(sig) || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), orientation: 1 };
}

function exifOrientation(b, start, end) {
  // APP1 payload: "Exif\0\0" then a TIFF header.
  if (b.toString('ascii', start, start + 6) !== 'Exif\0\0') return 1;
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const le = b.toString('ascii', tiff, tiff + 2) === 'II';
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

function jpegInfo(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let orientation = 1;
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    let marker = b[o + 1];
    while (marker === 0xff && o + 2 < b.length) {
      o += 1;
      marker = b[o + 1];
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const len = b.readUInt16BE(o + 2);
    const segStart = o + 4;
    const segEnd = o + 2 + len;
    if (len < 2 || segEnd > b.length) return null;
    if (marker === 0xe1) orientation = exifOrientation(b, segStart, segEnd);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { type: 'jpeg', height: b.readUInt16BE(segStart + 1), width: b.readUInt16BE(segStart + 3), orientation };
    }
    o = segEnd;
  }
  return null;
}

/** Type and size from the file's bytes, or null when it is not a JPEG or PNG. */
function inspect(buffer) {
  return pngInfo(buffer) || jpegInfo(buffer);
}

// --- Processing --------------------------------------------------------------

const TRANSFORMS = {
  2: (w, h) => [-1, 0, 0, 1, w, 0],
  3: (w, h) => [-1, 0, 0, -1, w, h],
  4: (w, h) => [1, 0, 0, -1, 0, h],
  5: () => [0, 1, 1, 0, 0, 0],
  6: (w, h) => [0, 1, -1, 0, h, 0],
  7: (w, h) => [0, -1, -1, 0, h, w],
  8: (w) => [0, -1, 1, 0, 0, w],
};

async function processImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new HttpError(400, 'Choose an image file to upload.');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'The image is larger than 5 MB.');
  const info = inspect(buffer);
  if (!info) throw new HttpError(415, 'Only JPEG and PNG images can be uploaded.', { code: 'unsupported_type' });
  if (!info.width || !info.height || info.width * info.height > MAX_PIXELS) {
    throw new HttpError(400, 'The image dimensions are too large. Use an image under 40 megapixels.');
  }
  const swapped = info.orientation >= 5;
  const w = swapped ? info.height : info.width;
  const h = swapped ? info.width : info.height;
  if (w < MIN_SIDE || h < MIN_SIDE) throw new HttpError(400, `The image must be at least ${MIN_SIDE} pixels wide and high.`);

  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    throw new HttpError(400, 'The image could not be read. It may be damaged; try exporting it again.');
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const outW = Math.round(w * scale);
  const outH = Math.round(h * scale);
  // Drawn size of the stored (unrotated) image.
  const drawW = swapped ? outH : outW;
  const drawH = swapped ? outW : outH;

  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (info.type === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
  }
  const t = TRANSFORMS[info.orientation];
  if (t) ctx.transform(...t(drawW, drawH));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, drawW, drawH);

  // PNG keeps transparency (logos); photos stay JPEG.
  const out = info.type === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', { quality: 0.86, progressive: true });
  const ext = info.type === 'png' ? 'png' : 'jpg';
  const sha256 = crypto.createHash('sha256').update(out).digest('hex');
  return { buffer: out, mime: info.type === 'png' ? 'image/png' : 'image/jpeg', ext, sha256, key: `${sha256}.${ext}`, width: outW, height: outH };
}

// --- Library -----------------------------------------------------------------

function meta(input, { requireAlt }) {
  const alt = typeof input.alt === 'string' ? input.alt.replace(/\s+/g, ' ').trim() : undefined;
  const caption = typeof input.caption === 'string' ? input.caption.replace(/\s+/g, ' ').trim() : undefined;
  const fields = {};
  if (requireAlt && !alt) fields.alt = 'Describe the image for people who cannot see it';
  if (alt !== undefined && alt.length > 300) fields.alt = 'Must be at most 300 characters';
  if (alt !== undefined && !requireAlt && !alt) fields.alt = 'Alternative text cannot be empty';
  if (caption !== undefined && caption.length > 300) fields.caption = 'Must be at most 300 characters';
  if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', { fields });
  return { ...(alt !== undefined ? { alt } : {}), ...(caption !== undefined ? { caption } : {}) };
}

function view(asset, uses = []) {
  return {
    ...imageView(asset),
    mime: asset.mime,
    size: asset.size,
    originalName: asset.originalName,
    uploadedByName: asset.uploadedByName,
    createdAt: asset.createdAt,
    replacedAt: asset.replacedAt,
    usedIn: uses,
  };
}

function checkId(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id.');
}

async function findOr404(id) {
  checkId(id);
  const asset = await Asset.findById(id);
  if (!asset) throw new HttpError(404, 'This image no longer exists.');
  return asset;
}

/** Deletes a stored file unless another library entry still points at it. */
async function releaseKey(key) {
  if (await Asset.exists({ key })) return;
  await store.remove(key);
}

async function list() {
  const [assets, uses] = await Promise.all([Asset.find().sort({ createdAt: -1 }).lean(), usageMap()]);
  return assets.map((a) => view(a, uses.get(String(a._id)) || []));
}

async function upload(buffer, input, actor) {
  const m = meta(input, { requireAlt: true });
  const img = await processImage(buffer);
  await store.put(img.key, img.buffer, img.mime);
  const asset = await Asset.create({
    key: img.key,
    sha256: img.sha256,
    mime: img.mime,
    size: img.buffer.length,
    width: img.width,
    height: img.height,
    alt: m.alt,
    caption: m.caption || '',
    originalName: String(input.originalName || '').slice(0, 200),
    uploadedBy: actor.id,
    uploadedByName: actor.name,
  });
  return view(asset.toObject());
}

/** New file, same library entry: every place that uses the image shows the new one. */
async function replace(id, buffer, input, actor) {
  const asset = await findOr404(id);
  const img = await processImage(buffer);
  await store.put(img.key, img.buffer, img.mime);
  const oldKey = asset.key;
  asset.set({
    key: img.key,
    sha256: img.sha256,
    mime: img.mime,
    size: img.buffer.length,
    width: img.width,
    height: img.height,
    originalName: String(input.originalName || asset.originalName).slice(0, 200),
    uploadedBy: actor.id,
    uploadedByName: actor.name,
    replacedAt: new Date(),
  });
  await asset.save();
  if (oldKey !== img.key) await releaseKey(oldKey);
  return view(asset.toObject(), (await usageMap()).get(String(asset._id)) || []);
}

async function updateMeta(id, input) {
  const asset = await findOr404(id);
  asset.set(meta(input, { requireAlt: false }));
  await asset.save();
  return view(asset.toObject(), (await usageMap()).get(String(asset._id)) || []);
}

async function remove(id) {
  const asset = await findOr404(id);
  const uses = (await usageMap()).get(String(asset._id)) || [];
  if (uses.length) {
    throw new HttpError(409, `This image is still in use (${uses.join('; ')}). Remove it from those places first.`, { code: 'in_use', usedIn: uses });
  }
  await Asset.deleteOne({ _id: asset._id });
  await releaseKey(asset.key);
  return { ok: true };
}

/** The image file for the public route, or null. Only files with a library entry are served. */
async function file(key) {
  if (!store.KEY_RE.test(key)) return null;
  const asset = await Asset.findOne({ key }).select('mime').lean();
  if (!asset) return null;
  const buffer = await store.get(key);
  return buffer ? { buffer, mime: asset.mime } : null;
}

module.exports = { inspect, processImage, list, upload, replace, updateMeta, remove, file, MAX_BYTES };
