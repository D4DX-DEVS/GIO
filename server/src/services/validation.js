// Server-side validation. The client validates too, but nothing the client
// sends is trusted. Values are only trimmed or put into canonical form
// (whitespace, district spelling) and the mobile number is combined with its
// country code; input that breaks a rule is rejected, never altered until it
// passes.
const { z } = require('zod');
const { AGE_MIN, AGE_MAX, STATUSES, PASS_STATUSES } = require('../config/constants');
const { matchDistrict } = require('../config/districts');
const { findCountry } = require('../config/countries');
const { env } = require('../config/env');
const { parseMobile } = require('../utils/phone');
const { HttpError } = require('../utils/httpError');

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// Letters (any script, with their combining marks) and single spaces only.
// Digits, dots, hyphens, apostrophes and every other symbol are refused.
const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const PLACE_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'()&/-]*$/u;
const AGE_RE = /^\d{1,3}$/;

const required = (label) => ({ required_error: `${label} is required`, invalid_type_error: `${label} is required` });

// Adds a custom issue and aborts the transform.
const fail = (ctx, message) => {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  return z.NEVER;
};

const place = (label) =>
  z
    .string(required(label))
    .transform(collapse)
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .min(2, `${label} must be at least 2 characters`)
        .max(100, `${label} must be at most 100 characters`)
        .regex(PLACE_RE, `${label} contains characters that are not allowed`)
    );

const name = z
  .string(required('Name'))
  .transform(collapse)
  .transform((v, ctx) => {
    if (!v) return fail(ctx, 'Name is required');
    if (/\p{N}/u.test(v)) return fail(ctx, 'Name cannot contain numbers');
    if (v.length < 2) return fail(ctx, 'Name must be at least 2 characters');
    if (v.length > 120) return fail(ctx, 'Name must be at most 120 characters');
    if (!NAME_RE.test(v)) return fail(ctx, 'Name can contain only letters and spaces (no numbers or special characters)');
    return v;
  });

// Accepts a JSON integer or a string of digits. Strings such as "25abc",
// "2.5", "0x1F" or "1e1" are refused rather than coerced.
const age = z
  .union([z.number(), z.string()], { errorMap: () => ({ message: 'Age is required' }) })
  .transform((v, ctx) => {
    let n;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return fail(ctx, 'Age is required');
      if (!AGE_RE.test(s)) return fail(ctx, 'Age must contain numbers only');
      n = Number(s);
    } else {
      if (!Number.isInteger(v)) return fail(ctx, 'Age must be a whole number');
      n = v;
    }
    if (n < AGE_MIN || n > AGE_MAX) return fail(ctx, `Age must be between ${AGE_MIN} and ${AGE_MAX}`);
    return n;
  });

// Digits only. Length and leading digit depend on the country code and are
// checked in parseRegistration once both fields are known.
const mobile = z.string(required('Mobile number')).transform((v, ctx) => {
  const raw = v.trim();
  if (!raw) return fail(ctx, 'Mobile number is required');
  if (!/^\d+$/.test(raw)) return fail(ctx, 'Mobile number can contain digits only');
  return raw;
});

const countryCode = z
  .string({ invalid_type_error: 'Select a country code from the list' })
  .optional()
  .transform((v, ctx) => {
    const code = v === undefined || v.trim() === '' ? env.defaultCountryCode : v.trim();
    return findCountry(code) ? code : fail(ctx, 'Select a country code from the list');
  });

const email = z
  .string(required('Email'))
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(1, 'Email is required')
      .max(200, 'Email is too long')
      .email('Enter a valid email address, e.g. name@example.com')
  );

const district = z.string(required('District')).transform((v, ctx) => {
  if (!v.trim()) return fail(ctx, 'District is required');
  return matchDistrict(v) ?? fail(ctx, 'Select a district from the list');
});

const registrationInput = z
  .object({
    name,
    age,
    countryCode,
    mobile,
    email,
    district,
    area: place('Area'),
    unit: place('Unit'),
    // Honeypot: hidden in the form, real users leave it empty.
    website: z.string().max(0).optional(),
  })
  .strict();

function fieldErrors(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0] ? String(issue.path[0]) : '_';
    if (!fields[key]) fields[key] = issue.code === 'unrecognized_keys' ? 'Unexpected field' : issue.message;
  }
  return fields;
}

function parseRegistration(body) {
  const result = registrationInput.safeParse(body ?? {});
  const fields = result.success ? {} : fieldErrors(result.error);

  // Length and format of the number for the chosen country.
  let e164 = null;
  if (!fields.mobile && !fields.countryCode && typeof body?.mobile === 'string') {
    const code = result.success ? result.data.countryCode : String(body.countryCode ?? '').trim() || env.defaultCountryCode;
    const parsed = parseMobile(code, body.mobile);
    if (parsed.error) fields.mobile = parsed.error;
    else e164 = parsed.e164;
  }

  if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', { fields });
  const { website, countryCode: _code, ...data } = result.data;
  return { ...data, mobile: e164 };
}

const listQuery = z.object({
  search: z.string().trim().max(100).optional().default(''),
  status: z.enum(['', ...STATUSES]).optional().default(''),
  district: z.string().trim().max(100).optional().default(''),
  area: z.string().trim().max(100).optional().default(''),
  unit: z.string().trim().max(100).optional().default(''),
  passStatus: z.enum(['', ...PASS_STATUSES]).optional().default(''),
  // ISO timestamps; the client converts the admin's local dates.
  from: z.union([z.literal(''), z.string().datetime({ offset: true })]).optional().default(''),
  to: z.union([z.literal(''), z.string().datetime({ offset: true })]).optional().default(''),
  sort: z.enum(['createdAt', 'name', 'age', 'district', 'status']).optional().default('createdAt'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

function parseListQuery(query) {
  const result = listQuery.safeParse(query ?? {});
  if (!result.success) throw new HttpError(400, 'Invalid list parameters.', { fields: fieldErrors(result.error) });
  return result.data;
}

const note = z.object({ note: z.string().trim().max(500).optional().default('') }).passthrough();

function parseNote(body) {
  const result = note.safeParse(body ?? {});
  if (!result.success) throw new HttpError(400, 'Note must be at most 500 characters.');
  return result.data.note;
}

module.exports = { parseRegistration, parseListQuery, parseNote };
