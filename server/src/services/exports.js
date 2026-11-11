// Registration list exports for the admin dashboard: an Excel workbook with
// every field, and a PDF table (A4 landscape) for printing. Both take the
// registrations the list shows for the same search, filters and sort. The
// check-in and check-out lists use the same files with their times added
// (`attendance: 'in' | 'out'`).
const ExcelJS = require('exceljs');
const { createCanvas } = require('canvas');
const { AGE_GROUPS, PASS_STATUS } = require('../config/constants');
const { formatForDisplay } = require('../utils/phone');
// Loading the pass renderer also registers the bundled Malayalam font.
const { FONT } = require('./passRenderer');

/** The admin's IANA time zone from the client, or UTC when it is missing or unknown. */
function timeZoneOf(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

const dateText = (date, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date);
const dateTimeText = (date, timeZone) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);

/** YYYY-MM-DD in the admin's time zone, for the file name. */
const isoDay = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** The time in `timeZone` held in a Date's UTC fields: Excel dates have no time zone. */
function wallClock(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

function ageGroupLabel(key) {
  const [min, max] = AGE_GROUPS[key];
  if (max === null) return `${min} and above`;
  return min === 0 ? `up to ${max}` : `${min}–${max}`;
}

/** One line naming the search and filters, printed on the PDF. Empty when there are none. */
function describeFilters(q, timeZone) {
  const parts = [];
  if (q.search) parts.push(`Search "${q.search}"`);
  if (q.pass) parts.push(q.pass === 'issued' ? 'Pass issued' : 'No pass yet');
  if (q.district) parts.push(`District: ${q.district}`);
  if (q.area) parts.push(`Area: ${q.area}`);
  if (q.unit) parts.push(`Unit: ${q.unit}`);
  if (q.children) parts.push(q.children === 'with' ? 'With children' : 'Without children');
  if (q.age) parts.push(`Age ${ageGroupLabel(q.age)}`);
  if (q.childAge) parts.push(`Child aged ${ageGroupLabel(q.childAge)}`);
  if (q.from) parts.push(`Registered from ${dateText(new Date(q.from), timeZone)}`);
  if (q.to) parts.push(`Registered to ${dateText(new Date(q.to), timeZone)}`);
  if (q.state) parts.push(q.state === 'inside' ? 'Not checked out' : 'Checked out');
  return parts.join(' · ');
}

// Children's names and ages are for admins only (`withChildren`), as on the
// registration page; the count is shown to everyone.
function rowOf(r, withChildren) {
  const kids = Array.isArray(r.children) ? r.children : null;
  return {
    regNo: r.regNo,
    name: r.name,
    age: r.age,
    gender: r.gender ?? '',
    mobile: formatForDisplay(r.mobile),
    whatsapp: r.whatsapp ? formatForDisplay(r.whatsapp) : '',
    email: r.email,
    district: r.district,
    area: r.area ?? '',
    unit: r.unit ?? '',
    place: r.place ?? '',
    // Blank = not recorded (registrations from the original form).
    childrenCount: kids ? kids.length : '',
    children: withChildren && kids ? kids.map((c) => (c.name ? `${c.name} (${c.age})` : String(c.age))).join(', ') : '',
    pass: r.passStatus !== PASS_STATUS.NONE ? 'Issued' : 'Not issued',
    passId: r.passId ?? '',
    createdAt: r.createdAt,
    checkedInAt: r.checkedInAt ?? null,
    checkedInByName: r.checkedInByName ?? '',
    checkedOutAt: r.checkedOutAt ?? null,
    checkedOutByName: r.checkedOutByName ?? '',
  };
}

const ATTENDANCE_TITLES = { in: 'Check-ins', out: 'Check-outs' };

// --- Excel ---------------------------------------------------------------------

const XLSX_COLUMNS = [
  { header: 'Reg No', key: 'regNo', width: 12 },
  { header: 'Name', key: 'name', width: 28 },
  { header: 'Age', key: 'age', width: 6 },
  { header: 'Gender', key: 'gender', width: 10 },
  { header: 'Mobile', key: 'mobile', width: 18 },
  { header: 'WhatsApp', key: 'whatsapp', width: 18 },
  { header: 'Email', key: 'email', width: 32 },
  { header: 'District', key: 'district', width: 20 },
  { header: 'Area', key: 'area', width: 20 },
  { header: 'Unit', key: 'unit', width: 20 },
  { header: 'Place', key: 'place', width: 20 },
  { header: 'Children', key: 'childrenCount', width: 9 },
  { header: 'Children (name, age)', key: 'children', width: 40 },
  { header: 'Entry pass', key: 'pass', width: 11 },
  { header: 'Pass ID', key: 'passId', width: 17 },
  { header: 'Registered', key: 'createdAt', width: 18, style: { numFmt: 'dd mmm yyyy hh:mm' } },
];

const XLSX_ATTENDANCE_COLUMNS = [
  { header: 'Checked in', key: 'checkedInAt', width: 18, style: { numFmt: 'dd mmm yyyy hh:mm:ss' } },
  { header: 'Checked in by', key: 'checkedInByName', width: 18 },
  { header: 'Checked out', key: 'checkedOutAt', width: 18, style: { numFmt: 'dd mmm yyyy hh:mm:ss' } },
  { header: 'Checked out by', key: 'checkedOutByName', width: 18 },
];

async function xlsx(docs, { timeZone, withChildren, attendance }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ATTENDANCE_TITLES[attendance] ?? 'Registrations', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [...XLSX_COLUMNS.filter((c) => withChildren || c.key !== 'children'), ...(attendance ? XLSX_ATTENDANCE_COLUMNS : [])];
  ws.getRow(1).font = { bold: true };
  const at = (d) => (d ? wallClock(d, timeZone) : null);
  for (const doc of docs) {
    const row = rowOf(doc, withChildren);
    ws.addRow({ ...row, createdAt: wallClock(row.createdAt, timeZone), checkedInAt: at(row.checkedInAt), checkedOutAt: at(row.checkedOutAt) });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// --- PDF -----------------------------------------------------------------------

// A4 landscape in points. The columns fill the width inside the margins.
const PAGE = { w: 842, h: 595, margin: 28 };
const TABLE_TOP = 84;
const HEAD_H = 20;
const ROW_H = 18;
const FOOTER_H = 18;
const ROWS_PER_PAGE = Math.floor((PAGE.h - PAGE.margin - FOOTER_H - TABLE_TOP - HEAD_H) / ROW_H);
const INK = '#1e293b';
const MUTED = '#64748b';
const BRAND = '#5a0b16';

const PDF_COLUMNS = [
  { header: '#', w: 28, right: true, value: (r, i) => String(i + 1) },
  { header: 'Reg No', w: 62, value: (r) => r.regNo },
  { header: 'Name', w: 128, value: (r) => r.name },
  { header: 'Age', w: 28, right: true, value: (r) => String(r.age) },
  { header: 'Mobile', w: 92, value: (r) => r.mobile },
  { header: 'Email', w: 140, value: (r) => r.email },
  { header: 'District', w: 88, value: (r) => r.district },
  { header: 'Area · Unit · Place', w: 116, value: (r) => [r.area, r.unit, r.place].filter(Boolean).join(' · ') },
  { header: 'Children', w: 44, right: true, value: (r) => (r.childrenCount ? String(r.childrenCount) : '') },
  { header: 'Registered', w: 60, value: (r, _i, timeZone) => dateText(r.createdAt, timeZone) },
];

// Same width as PDF_COLUMNS: the check-in and check-out times replace the email and registration date.
const timeText = (d, timeZone) => (d ? dateTimeText(d, timeZone) : '');
const PDF_ATTENDANCE_COLUMNS = [
  ...PDF_COLUMNS.slice(0, 5),
  { header: 'District', w: 88, value: (r) => r.district },
  { header: 'Area · Unit · Place', w: 124, value: (r) => [r.area, r.unit, r.place].filter(Boolean).join(' · ') },
  { header: 'Children', w: 44, right: true, value: (r) => (r.childrenCount ? String(r.childrenCount) : '') },
  { header: 'Checked in', w: 96, value: (r, _i, timeZone) => timeText(r.checkedInAt, timeZone) },
  { header: 'Checked out', w: 96, value: (r, _i, timeZone) => timeText(r.checkedOutAt, timeZone) },
];

/** `text` cut to `width` with an ellipsis. */
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${chars.slice(0, mid).join('')}…`).width <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

function pdf(docs, { timeZone, summary, event, attendance }) {
  const title = ATTENDANCE_TITLES[attendance] ?? 'Registrations';
  const columns = attendance ? PDF_ATTENDANCE_COLUMNS : PDF_COLUMNS;
  const rows = docs.map((d) => rowOf(d, false));
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const canvas = createCanvas(PAGE.w, PAGE.h, 'pdf');
  const ctx = canvas.getContext('2d');
  const inner = PAGE.w - PAGE.margin * 2;
  const now = new Date();
  const countLine = `${rows.length} registration${rows.length === 1 ? '' : 's'} · Exported ${dateTimeText(now, timeZone)}`;

  const text = (s, x, y, { size = 9, bold = false, color = INK, right = false, width } = {}) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = right ? 'right' : 'left';
    ctx.fillText(width ? fit(ctx, s, width) : s, x, y);
  };

  for (let p = 0; p < pages; p += 1) {
    if (p > 0) ctx.addPage(PAGE.w, PAGE.h);
    // Real text with embedded fonts: selectable, and a fraction of the size of
    // the default glyph outlines.
    ctx.textDrawingMode = 'glyph';
    ctx.textBaseline = 'middle';

    text(title, PAGE.margin, PAGE.margin + 8, { size: 16, bold: true, color: BRAND });
    if (event) text(event, PAGE.w - PAGE.margin, PAGE.margin + 8, { size: 9, color: MUTED, right: true, width: inner / 2 });
    text(countLine, PAGE.margin, PAGE.margin + 30, { color: MUTED });
    if (summary) text(summary, PAGE.margin, PAGE.margin + 44, { color: MUTED, width: inner });

    ctx.fillStyle = BRAND;
    ctx.fillRect(PAGE.margin, TABLE_TOP, inner, HEAD_H);
    let x = PAGE.margin;
    for (const c of columns) {
      text(c.header, c.right ? x + c.w - 4 : x + 4, TABLE_TOP + HEAD_H / 2, { size: 8, bold: true, color: '#ffffff', right: c.right, width: c.w - 8 });
      x += c.w;
    }

    const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    slice.forEach((r, j) => {
      const i = p * ROWS_PER_PAGE + j;
      const y = TABLE_TOP + HEAD_H + j * ROW_H;
      if (j % 2 === 1) {
        ctx.fillStyle = '#f8f5f4';
        ctx.fillRect(PAGE.margin, y, inner, ROW_H);
      }
      let cx = PAGE.margin;
      for (const c of columns) {
        text(c.value(r, i, timeZone), c.right ? cx + c.w - 4 : cx + 4, y + ROW_H / 2, { size: 8, right: c.right, width: c.w - 8 });
        cx += c.w;
      }
    });
    if (!rows.length) text('No registrations match.', PAGE.margin + 4, TABLE_TOP + HEAD_H + ROW_H / 2, { color: MUTED });

    const tableBottom = TABLE_TOP + HEAD_H + Math.max(slice.length, 1) * ROW_H;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(PAGE.margin, tableBottom);
    ctx.lineTo(PAGE.w - PAGE.margin, tableBottom);
    ctx.stroke();

    text(`Page ${p + 1} of ${pages}`, PAGE.w - PAGE.margin, PAGE.h - PAGE.margin, { size: 8, color: MUTED, right: true });
  }

  return canvas.toBuffer('application/pdf', { title, creationDate: now });
}

module.exports = { xlsx, pdf, timeZoneOf, describeFilters, isoDay };
