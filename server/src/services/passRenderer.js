// Renders an entry pass as a PNG (WhatsApp displays images inline; a PDF
// would arrive as a document the attendee has to open).
//
// No emoji: canvas has no emoji font on most servers.
const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const { qrPayload } = require('../utils/passTokens');

const W = 1080;
// Base height. Passes for registrations from the new form grow by a row for
// Place and a band for accompanying children; older passes keep this size.
const BASE_H = 1660;
const PLACE_ROW_H = 100;
const CHILDREN_BAND_H = 110;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans", "Noto Sans Malayalam", sans-serif';
const MONO = '"Consolas", "Courier New", monospace';

const C = {
  ink: '#14213d',
  muted: '#5b6478',
  line: '#dde2ec',
  brand: '#0f5c4d',
  brandDark: '#0a3f35',
  accent: '#f2b705',
  paper: '#ffffff',
  bg: '#eef2f6',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Largest font size (down to `min`) at which `text` fits in `maxWidth`.
function fitText(ctx, text, weight, size, min, maxWidth, family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function wrap(ctx, text, maxWidth, maxLines) {
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
  return lines.slice(0, maxLines);
}

/**
 * @param pass  EntryPass document (holder details frozen at issue)
 * @param event current event details { name, date, venue } (services/site.js)
 */
async function renderPass(pass, event) {
  const h = pass.holder || {};
  const children = typeof h.childrenCount === 'number' ? h.childrenCount : null;
  const H = BASE_H + (h.place ? PLACE_ROW_H : 0) + (children > 0 ? CHILDREN_BAND_H : 0);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const cx = 60;
  const cy = 60;
  const cw = W - 120;
  const ch = H - 120;
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 36);
  ctx.fillStyle = C.paper;
  ctx.shadowColor = 'rgba(20,33,61,0.12)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  ctx.fill();
  ctx.restore();

  // Header band
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 36);
  ctx.clip();
  const grad = ctx.createLinearGradient(cx, cy, cx + cw, cy + 300);
  grad.addColorStop(0, C.brand);
  grad.addColorStop(1, C.brandDark);
  ctx.fillStyle = grad;
  ctx.fillRect(cx, cy, cw, 330);
  ctx.fillStyle = C.accent;
  ctx.fillRect(cx, cy + 330, cw, 8);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText('E N T R Y   P A S S', W / 2, cy + 80);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 54px ${FONT}`;
  const titleLines = wrap(ctx, String(event.name || '').toUpperCase(), cw - 100, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, cy + 160 + i * 64));

  const meta = [event.date, event.venue].filter(Boolean).join('  |  ');
  if (meta) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    fitText(ctx, meta, 500, 28, 18, cw - 100);
    ctx.fillText(meta, W / 2, cy + (titleLines.length > 1 ? 300 : 250));
  }

  // Attendee
  let y = cy + 420;
  ctx.fillStyle = C.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText('A T T E N D E E', W / 2, y);
  y += 66;
  ctx.fillStyle = C.ink;
  fitText(ctx, h.name || '', 700, 56, 30, cw - 100);
  ctx.fillText(h.name || '', W / 2, y);

  // Details grid
  y += 50;
  const rows = [
    ['Reg. No', h.regNo],
    ['District', h.district],
    ['Area', h.area],
    ['Unit', h.unit],
  ];
  const colW = (cw - 100) / 2;
  rows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = cx + 50 + col * colW + colW / 2;
    const ry = y + row * 100;
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(label.toUpperCase(), x, ry + 30);
    ctx.fillStyle = C.ink;
    fitText(ctx, value || '-', 600, 32, 18, colW - 30);
    ctx.fillText(value || '-', x, ry + 72);
  });
  y += 220;

  if (h.place) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText('PLACE', W / 2, y + 10);
    ctx.fillStyle = C.ink;
    fitText(ctx, h.place, 600, 32, 18, cw - 100);
    ctx.fillText(h.place, W / 2, y + 52);
    y += PLACE_ROW_H;
  }

  // Number only; children's ages are never printed.
  if (children > 0) {
    const bandY = y - 10;
    roundRect(ctx, cx + 50, bandY, cw - 100, 84, 18);
    ctx.fillStyle = '#fff7db';
    ctx.fill();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(`Accompanying children: ${children}`, W / 2, bandY + 54);
    y += CHILDREN_BAND_H;
  }

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(cx + 40, y);
  ctx.lineTo(cx + cw - 40, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // QR code: signed payload, never the bare pass ID
  y += 40;
  const qrSize = 440;
  const qrDataUrl = await QRCode.toDataURL(qrPayload(pass.passId, pass.version), {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  const qr = await loadImage(qrDataUrl);
  roundRect(ctx, (W - qrSize - 40) / 2, y, qrSize + 40, qrSize + 40, 20);
  ctx.strokeStyle = C.line;
  ctx.stroke();
  ctx.drawImage(qr, (W - qrSize) / 2, y + 20, qrSize, qrSize);
  y += qrSize + 40 + 60;

  ctx.fillStyle = C.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText('P A S S   I D', W / 2, y);
  ctx.fillStyle = C.ink;
  ctx.font = `700 44px ${MONO}`;
  ctx.fillText(pass.passId, W / 2, y + 54);

  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${FONT}`;
  const footer =
    children > 0
      ? `Show this QR code at the entrance. Valid for the holder and ${children} accompanying ${children === 1 ? 'child' : 'children'}.`
      : 'Show this QR code at the entrance. Valid for one person only.';
  fitText(ctx, footer, 400, 22, 16, cw - 60);
  ctx.fillText(footer, W / 2, cy + ch - 40);

  return canvas.toBuffer('image/png');
}

module.exports = { renderPass };
