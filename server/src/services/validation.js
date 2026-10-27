// Server-side validation. The client validates too, but nothing the client
// sends is trusted. Values are only trimmed or put into canonical form
// (whitespace, district spelling) and each phone number is combined with its
// country code; input that breaks a rule is rejected, never altered until it
// passes.
const { z } = require('zod');
const { AGE_MIN, AGE_MAX, FORM_VERSION, PLACE_REQUIRED } = require('../config/constants');
const { EMPTY_PAGE, childrenRules } = require('../config/siteSchema');
const { matchDistrict } = require('../config/districts');
const { env } = require('../config/env');
const { parseMobile, countryForDial } = require('../utils/phone');
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

/** Same rules as `name` below; null when valid. */
function nameError(raw, label = 'Name') {
  const v = collapse(String(raw));
  if (!v) return `${label} is required`;
  if (/\p{N}/u.test(v)) return `${label} cannot contain numbers`;
  if (v.length < 2) return `${label} must be at least 2 characters`;
  if (v.length > 120) return `${label} must be at most 120 characters`;
  if (!NAME_RE.test(v)) return `${label} can contain only letters and spaces (no numbers or special characters)`;
  return null;
}

const name = z
  .string(required('Name'))
  .transform(collapse)
  .transform((v, ctx) => {
    const error = nameError(v);
    return error ? fail(ctx, error) : v;
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

// Digits only. Length and leading digits depend on the country and are
// checked in parseRegistration once both fields are known.
const mobile = z.string(required('Mobile number')).transform((v, ctx) => {
  const raw = v.trim();
  if (!raw) return fail(ctx, 'Mobile number is required');
  if (!/^\d+$/.test(raw)) return fail(ctx, 'Mobile number can contain digits only');
  return raw;
});

const defaultCountry = () => countryForDial(env.defaultCountryCode) || 'IN';

// Version 1 sends the calling code ("91"); it is read as that code's main country.
const countryCode = z
  .string({ invalid_type_error: 'Select a country code from the list' })
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return defaultCountry();
    return countryForDial(v.trim()) ?? fail(ctx, 'Select a country code from the list');
  });

// Version 3 sends the country itself ("IN"). Checked against the phone
// metadata in parseRegistration.
const country = z
  .string({ invalid_type_error: 'Select a country from the list' })
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? defaultCountry() : v.trim().toUpperCase()));

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

// Empty or only spaces counts as not given.
const optionalPlace = (label) => z.preprocess((v) => (typeof v === 'string' && !v.trim() ? undefined : v), place(label).optional());

const common = {
  name,
  age,
  email,
  district,
  // Honeypot: hidden in the form, real users leave it empty.
  website: z.string().max(0).optional(),
};

// Version 1: the original form. Kept so a form page opened long before a
// deploy still submits.
const registrationInput = z
  .object({ ...common, countryCode, mobile, area: place('Area'), unit: place('Unit') })
  .strict();

// Version 3: the current form. Gender and children are checked against the
// admin-set rules afterwards.
const registrationInputV3 = z
  .object({
    ...common,
    formVersion: z.literal(FORM_VERSION),
    area: optionalPlace('Area'),
    unit: optionalPlace('Unit'),
    gender: z.string({ invalid_type_error: 'Select an option' }).max(30).optional(),
    place: PLACE_REQUIRED ? place('Place') : optionalPlace('Place'),
    // Key returned by POST /api/public/photos; checked against Spaces in the route.
    photo: z
      .string({ required_error: 'Please add your photo', invalid_type_error: 'Please add your photo' })
      .regex(/^[a-f0-9]{32}\.jpg$/, 'Please add your photo'),
    mobileCountry: country,
    mobile,
    whatsappSameAsMobile: z.boolean({ required_error: 'Required', invalid_type_error: 'Required' }),
    whatsappCountry: country,
    whatsapp: z.string({ invalid_type_error: 'WhatsApp number can contain digits only' }).optional(),
    childrenCount: z
      .union([z.number(), z.string()], { errorMap: () => ({ message: 'Enter the number of children' }) })
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v === '') return 0;
        const s = String(v).trim();
        if (!/^\d{1,2}$/.test(s)) return fail(ctx, 'Enter the number of children as a whole number');
        return Number(s);
      }),
    children: z
      .array(
        z.object({ name: z.unknown().optional(), age: z.unknown().optional() }, { invalid_type_error: "Enter each child's name and age" }).strict(),
        { invalid_type_error: "Enter each child's name and age" }
      )
      .max(50)
      .optional(),
  })
  .strict();

function fieldErrors(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const top = String(issue.path[0] ?? '_');
    // Children are reported per child and field ("children.0.age"); everything else per field.
    const k = top === 'children' && issue.path.length > 1 ? issue.path.slice(0, 3).map(String).join('.') : top;
    if (!fields[k]) fields[k] = issue.code === 'unrecognized_keys' ? 'Unexpected field' : issue.message;
  }
  return fields;
}

/** Gender, WhatsApp and children rules that need the admin-set form rules. */
function checkV3(data, rules, fields, e164) {
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

  // WhatsApp: same as the phone number, or its own number and country.
  if (data.whatsappSameAsMobile) {
    if (data.whatsapp && data.whatsapp.trim() && e164) {
      const own = parseMobile(data.whatsappCountry, data.whatsapp, 'WhatsApp');
      if (own.e164 && own.e164 !== e164) fields.whatsapp = 'Untick "Same as phone number" to use a different WhatsApp number';
    }
    out.whatsapp = e164;
  } else {
    const raw = typeof data.whatsapp === 'string' ? data.whatsapp.trim() : '';
    if (!raw) fields.whatsapp = 'Please enter your WhatsApp number';
    else {
      const parsed = parseMobile(data.whatsappCountry, raw, 'WhatsApp');
      if (parsed.error) fields[parsed.error.startsWith('Select') ? 'whatsappCountry' : 'whatsapp'] = parsed.error;
      else out.whatsapp = parsed.e164;
    }
  }

  // Children: the number, then a name and age for each child.
  const limits = childrenRules(rules);
  const count = data.childrenCount;
  const children = data.children || [];
  if (count > limits.max) {
    fields.childrenCount = `At most ${limits.max} accompanying children`;
    return out;
  }
  if (children.length !== count) {
    fields.childrenCount = "Enter a name and age for each child";
    return out;
  }
  out.children = [];
  children.forEach((child, i) => {
    const n = typeof child.name === 'string' ? collapse(child.name) : '';
    const nameErr = typeof child.name === 'string' ? nameError(n, 'Name') : 'Please enter the name';
    if (nameErr) fields[`children.${i}.name`] = nameErr.replace(/^Name is required$/, 'Please enter the name');

    const a = child.age;
    const s = typeof a === 'number' ? (Number.isInteger(a) ? String(a) : 'x') : typeof a === 'string' ? a.trim() : '';
    if (!s) fields[`children.${i}.age`] = 'Please enter the age';
    else if (!/^\d{1,2}$/.test(s)) fields[`children.${i}.age`] = 'Age must contain numbers only';
    else if (+s < limits.ageMin || +s > limits.ageMax) fields[`children.${i}.age`] = `Age must be between ${limits.ageMin} and ${limits.ageMax}`;

    if (!nameErr && !fields[`children.${i}.age`]) out.children.push({ name: n, age: Number(s) });
  });
  return out;
}

/**
 * Validates a public submission. `rules` are the published form rules
 * (gender options, children limits); they only apply to the current form.
 */
function parseRegistration(body, rules = EMPTY_PAGE.form) {
  const input = body ?? {};
  if (input.formVersion !== undefined && input.formVersion !== FORM_VERSION) {
    throw new HttpError(400, 'This form is out of date. Please reload the page and try again.', { code: 'form_outdated' });
  }
  const current = input.formVersion === FORM_VERSION;
  const result = (current ? registrationInputV3 : registrationInput).safeParse(input);
  const fields = result.success ? {} : fieldErrors(result.error);

  // Length and format of the number for the chosen country.
  let e164 = null;
  const countryField = current ? 'mobileCountry' : 'countryCode';
  if (!fields.mobile && !fields[countryField] && typeof input.mobile === 'string') {
    let iso;
    if (result.success) iso = result.data[countryField];
    else if (current) iso = String(input.mobileCountry ?? '').trim().toUpperCase() || defaultCountry();
    else iso = countryForDial(String(input.countryCode ?? '').trim()) || defaultCountry();
    const parsed = parseMobile(iso, input.mobile);
    if (parsed.error) fields[parsed.error.startsWith('Select') ? countryField : 'mobile'] = parsed.error;
    else e164 = parsed.e164;
  }

  let extra = {};
  if (current && result.success) extra = checkV3(result.data, rules, fields, e164);

  if (Object.keys(fields).length) throw new HttpError(400, 'Please correct the highlighted fields.', { fields });
  const {
    website,
    countryCode: _code,
    mobileCountry,
    whatsappCountry,
    whatsappSameAsMobile,
    childrenCount,
    children,
    gender,
    whatsapp,
    ...data
  } = result.data;
  return { ...data, area: data.area ?? '', unit: data.unit ?? '', mobile: e164, ...extra };
}

const listQuery = z.object({
  search: z.string().trim().max(100).optional().default(''),
  district: z.string().trim().max(100).optional().default(''),
  area: z.string().trim().max(100).optional().default(''),
  unit: z.string().trim().max(100).optional().default(''),
  // issued: the registration has an entry pass; missing: it has none yet.
  pass: z.enum(['', 'issued', 'missing']).optional().default(''),
  // ISO timestamps; the client converts the admin's local dates.
  from: z.union([z.literal(''), z.string().datetime({ offset: true })]).optional().default(''),
  to: z.union([z.literal(''), z.string().datetime({ offset: true })]).optional().default(''),
  sort: z.enum(['createdAt', 'name', 'age', 'district']).optional().default('createdAt'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

function parseListQuery(query) {
  const result = listQuery.safeParse(query ?? {});
  if (!result.success) throw new HttpError(400, 'Invalid list parameters.', { fields: fieldErrors(result.error) });
  return result.data;
}

module.exports = { parseRegistration, parseListQuery };
