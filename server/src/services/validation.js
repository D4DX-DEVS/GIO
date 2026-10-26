// Server-side validation. The client validates too, but nothing the client
// sends is trusted. Values are only trimmed or put into canonical form
// (whitespace, district spelling) and the mobile number is combined with its
// country code; input that breaks a rule is rejected, never altered until it
// passes.
const { z } = require('zod');
const { AGE_MIN, AGE_MAX, STATUSES, PASS_STATUSES, FORM_VERSION, PLACE_REQUIRED } = require('../config/constants');
const { EMPTY_PAGE, childrenEnabled } = require('../config/siteSchema');
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

// Version 1: the original form. Kept unchanged so a form page opened before
// the new form was deployed still submits.
const v1Fields = {
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
};

const registrationInput = z.object(v1Fields).strict();

// Version 2 adds gender, place, a WhatsApp number and accompanying children.
// Gender and children are checked against the admin-set rules afterwards.
const optionalPlace = (label) =>
  z
    .union([z.literal(''), z.undefined()])
    .transform(() => undefined)
    .or(place(label));

const registrationInputV2 = z
  .object({
    ...v1Fields,
    formVersion: z.literal(FORM_VERSION),
    gender: z.string({ invalid_type_error: 'Select an option' }).max(30).optional(),
    place: PLACE_REQUIRED ? place('Place') : optionalPlace('Place'),
    whatsappSameAsMobile: z.boolean({ required_error: 'Required', invalid_type_error: 'Required' }),
    whatsapp: z.string({ invalid_type_error: 'WhatsApp number can contain digits only' }).optional(),
    childrenCount: z
      .union([z.number(), z.string()], { errorMap: () => ({ message: 'Select the number of children' }) })
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v === '') return 0;
        const s = String(v).trim();
        if (!/^\d{1,2}$/.test(s)) return fail(ctx, 'Select the number of children');
        return Number(s);
      }),
    childAges: z.array(z.union([z.number(), z.string()]), { invalid_type_error: "Enter each child's age" }).max(50).optional(),
  })
  .strict();

function fieldErrors(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0] !== undefined ? issue.path.map(String).join('.') : '_';
    const top = String(issue.path[0] ?? '_');
    // Child ages are reported per child ("childAges.0"); everything else per field.
    const k = top === 'childAges' ? key : top;
    if (!fields[k]) fields[k] = issue.code === 'unrecognized_keys' ? 'Unexpected field' : issue.message;
  }
  return fields;
}

/** Gender, WhatsApp and children rules that need the admin-set form rules. */
function checkV2(body, data, rules, fields, e164) {
  const out = {};

  // Gender: one of the configured options; not asked while none are set.
  const options = rules.genderOptions || [];
  const gender = typeof data.gender === 'string' ? data.gender.trim() : '';
  if (options.length) {
    const match = options.find((o) => o.toLowerCase() === gender.toLowerCase());
    if (!gender) fields.gender = 'Please select an option';
    else if (!match) fields.gender = 'Select an option from the list';
    else out.gender = match;
  } else if (gender) fields.gender = 'Unexpected field';

  // WhatsApp: same as the phone number, or its own number with the same country code.
  if (data.whatsappSameAsMobile) {
    if (data.whatsapp && data.whatsapp.trim() && e164) {
      const own = parseMobile(data.countryCode, data.whatsapp);
      if (own.e164 && own.e164 !== e164) fields.whatsapp = 'Untick "Same as phone number" to use a different WhatsApp number';
    }
    out.whatsapp = e164;
  } else {
    const raw = typeof data.whatsapp === 'string' ? data.whatsapp.trim() : '';
    if (!raw) fields.whatsapp = 'Please enter your WhatsApp number';
    else {
      const parsed = parseMobile(data.countryCode, raw);
      if (parsed.error) fields.whatsapp = parsed.error.replace('Mobile number', 'WhatsApp number');
      else out.whatsapp = parsed.e164;
    }
  }

  // Children: the number and one age per child, within the configured limits.
  const count = data.childrenCount;
  const ages = Array.isArray(body.childAges) ? body.childAges : [];
  if (!childrenEnabled(rules)) {
    // Not asked while the limits are unset, so nothing is recorded.
    if (count > 0 || ages.length) fields.childrenCount = 'Accompanying children cannot be added at the moment';
    return out;
  }
  if (count > rules.childrenMax) {
    fields.childrenCount = `At most ${rules.childrenMax} accompanying children`;
    return out;
  }
  if (ages.length !== count) {
    fields.childrenCount = 'Enter one age for each child';
    return out;
  }
  const children = [];
  ages.forEach((a, i) => {
    const s = typeof a === 'number' ? (Number.isInteger(a) ? String(a) : 'x') : String(a).trim();
    if (!s) fields[`childAges.${i}`] = 'Please enter the age';
    else if (!/^\d{1,2}$/.test(s)) fields[`childAges.${i}`] = 'Age must contain numbers only';
    else if (+s < rules.childAgeMin || +s > rules.childAgeMax) fields[`childAges.${i}`] = `Age must be between ${rules.childAgeMin} and ${rules.childAgeMax}`;
    else children.push({ age: Number(s) });
  });
  out.children = children;
  return out;
}

/**
 * Validates a public submission. `rules` are the published form rules
 * (gender options, children limits); they only apply to form version 2.
 */
function parseRegistration(body, rules = EMPTY_PAGE.form) {
  const input = body ?? {};
  if (input.formVersion !== undefined && input.formVersion !== FORM_VERSION) {
    throw new HttpError(400, 'This form is out of date. Please reload the page and try again.', { code: 'form_outdated' });
  }
  const v2 = input.formVersion === FORM_VERSION;
  const result = (v2 ? registrationInputV2 : registrationInput).safeParse(input);
  const fields = result.success ? {} : fieldErrors(result.error);

  // Length and format of the number for the chosen country.
  let e164 = null;
  if (!fields.mobile && !fields.countryCode && typeof input.mobile === 'string') {
    const code = result.success ? result.data.countryCode : String(input.countryCode ?? '').trim() || env.defaultCountryCode;
    const parsed = parseMobile(code, input.mobile);
    if (parsed.error) fields.mobile = parsed.error;
    else e164 = parsed.e164;
  }

  let extra = {};
  if (v2 && result.success) extra = checkV2(input, result.data, rules, fields, e164);

  if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', { fields });
  const { website, countryCode: _code, whatsappSameAsMobile, childrenCount, childAges, gender, whatsapp, ...data } = result.data;
  return { ...data, mobile: e164, ...extra };
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
