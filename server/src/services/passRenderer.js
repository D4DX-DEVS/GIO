// Renders an entry pass as a PNG on the delegate frame (assets/pass-frame.png,
// the designers' template scaled to 1080 wide; the date and venue are part of
// the artwork). It is shown on the registration success page, where the
// registrant can download or share it, and stored in DigitalOcean Spaces
// (services/passes.js).
//
// No emoji: canvas has no emoji font on most servers.
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
const QRCode = require('qrcode');
const { qrPayload } = require('../utils/passTokens');

// Linux hosts such as DigitalOcean App Platform have no Malayalam font, so
// Malayalam names would print as empty boxes. Bundled (SIL OFL, see fonts/OFL.txt).
const FONT_DIR = path.join(__dirname, '../../fonts');
registerFont(path.join(FONT_DIR, 'NotoSansMalayalam-Regular.ttf'), { family: 'Noto Sans Malayalam' });
registerFont(path.join(FONT_DIR, 'NotoSansMalayalam-Bold.ttf'), { family: 'Noto Sans Malayalam', weight: 'bold' });

const FRAME_PATH = path.join(__dirname, '../../assets/pass-frame.png');
// Bump when the design changes: stored images drawn on an older design are
// drawn again on the current one when next viewed (services/passes.js).
const TEMPLATE = 2;
const W = 1080;
const H = 1440;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans", "Noto Sans Malayalam", sans-serif';

// Positions on the frame. The photo shows through its transparent window,
// behind the DELEGATE band; the name, pass ID and QR code sit in the space
// between the window and the date/logo footer (which starts at y 1195).
const PHOTO = { x: 170, y: 481, w: 586, h: 507 };
const LEFT = 170; // left edge of the window and the footer
const RIGHT = 917; // right edge of the title and the GIO logo
const QR_TILE = 168;
const QR_TOP = 1008;
const NAME_TOP = 1024;
const NAME_W = RIGHT - QR_TILE - 32 - LEFT;

let frame;
const loadFrame = () => (frame ??= loadImage(FRAME_PATH));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Largest size at which the name fits: one line down to 32px, then two lines
// down to 22px, then three (names can be 120 characters).
function fitName(ctx, text) {
  let size = 46;
  let lines;
  for (;;) {
    ctx.font = `700 ${size}px ${FONT}`;
    lines = wrap(ctx, text, NAME_W);
    const maxLines = size >= 32 ? 1 : size >= 22 ? 2 : 3;
    if (size <= 16 || (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= NAME_W))) break;
    size -= 2;
  }
  return { size, lines };
}

// Draws `img` to fill the box, cropping the overflow from the centre
// sideways and from `focusY` (0 top, 1 bottom) vertically.
function drawCover(ctx, img, x, y, w, h, focusY = 0.5) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * focusY, sw, sh, x, y, w, h);
}

/**
 * @param pass  EntryPass document (holder details frozen at issue)
 * @param photo the holder's photo (JPEG buffer) or null
 */
async function renderPass(pass, photo = null) {
  const h = pass.holder || {};
  let photoImg = null;
  if (photo) {
    try {
      photoImg = await loadImage(photo);
    } catch {
      photoImg = null; // the pass is still valid without it
    }
  }
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Photo first, so the frame and its DELEGATE band lie over it. Biased
  // towards the top: the band covers the bottom of the window.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(PHOTO.x - 2, PHOTO.y - 2, PHOTO.w + 4, PHOTO.h + 4);
  if (photoImg) drawCover(ctx, photoImg, PHOTO.x - 2, PHOTO.y - 2, PHOTO.w + 4, PHOTO.h + 4, 0.25);
  ctx.drawImage(await loadFrame(), 0, 0, W, H);

  // Name in capitals, whatever case it was typed in.
  const name = String(h.name || '').toUpperCase();
  const { size, lines } = fitName(ctx, name);
  const lineH = Math.round(size * 1.15);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let y = NAME_TOP + Math.round(size * 0.74);
  lines.forEach((l, i) => ctx.fillText(l, LEFT, y + i * lineH));
  y += (lines.length - 1) * lineH;

  // For gate staff to type when the QR code cannot be scanned.
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`PASS ID  ${pass.passId}`, LEFT, y + 42);

  // QR code: signed payload, never the bare pass ID
  const qrX = RIGHT - QR_TILE;
  roundRect(ctx, qrX, QR_TOP, QR_TILE, QR_TILE, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  const qrSize = QR_TILE - 28;
  const qrDataUrl = await QRCode.toDataURL(qrPayload(pass.passId, pass.version), {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  const qr = await loadImage(qrDataUrl);
  ctx.drawImage(qr, qrX + 14, QR_TOP + 14, qrSize, qrSize);

  return canvas.toBuffer('image/png');
}

module.exports = { renderPass, TEMPLATE };
