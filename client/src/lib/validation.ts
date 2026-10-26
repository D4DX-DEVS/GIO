// Registration form rules. These mirror server/src/services/validation.js for
// instant feedback; the server re-validates everything and has the final say.
// Nothing here changes what the user typed to make it pass.

export type FormValues = {
  name: string;
  age: string;
  mobile: string;
  email: string;
  district: string;
  area: string;
  unit: string;
};
export type FieldKey = keyof FormValues;
export type Errors = Partial<Record<FieldKey, string>>;

export type Country = { dial: string; iso: string; name: string; lengths: number[]; starts: string };
// `country` is the event's default country; the form asks for the national number only.
export type Rules = { ageMin: number; ageMax: number; districts: string[]; country?: Country };

// Letters (any script, with their combining marks) and single spaces only.
const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const PLACE_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'()&/-]*$/u;
// Same pattern zod uses for z.string().email() on the server.
const EMAIL_RE = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;
const DIGITS = /^\d+$/;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Same rule as server/src/utils/phone.js: an error message, or undefined when valid. */
export function mobileError(raw: string, country?: Country): string | undefined {
  const v = raw.trim();
  if (!v) return 'Please enter your mobile number';
  if (!DIGITS.test(v)) return 'Mobile number can contain digits only';
  if (!country) return undefined;
  if (!country.lengths.includes(v.length)) return `Enter a valid ${country.lengths.join(' or ')}-digit mobile number`;
  if (!country.starts.includes(v[0])) return 'Enter a valid mobile number';
  return undefined;
}

export function matchDistrict(value: string, districts: string[]) {
  const key = value.trim().toLocaleLowerCase('en');
  return districts.find((d) => d.toLocaleLowerCase('en') === key) ?? null;
}

const NAME_SYMBOLS = 'Name can contain only letters and spaces (no numbers or special characters)';

const validators: Record<FieldKey, (v: string, r: Rules) => string | undefined> = {
  name(raw) {
    const v = collapse(raw);
    if (!v) return 'Please enter your name';
    if (/\p{N}/u.test(v)) return 'Name cannot contain numbers';
    if (!NAME_RE.test(v)) return NAME_SYMBOLS;
    if (v.length < 2) return 'Name must be at least 2 characters';
    if (v.length > 120) return 'Name must be at most 120 characters';
    return undefined;
  },
  age(raw, r) {
    const v = raw.trim();
    if (!v) return 'Please enter your age';
    if (!/^\d+$/.test(v)) return 'Age must contain numbers only';
    if (v.length > 3 || +v < r.ageMin || +v > r.ageMax) return `Age must be between ${r.ageMin} and ${r.ageMax}`;
    return undefined;
  },
  mobile(raw, r) {
    return mobileError(raw, r.country);
  },
  email(raw) {
    const v = raw.trim();
    if (!v) return 'Please enter your email address';
    if (v.length > 200 || !EMAIL_RE.test(v)) return 'Enter a valid email address, e.g. name@example.com';
    return undefined;
  },
  district(raw, r) {
    if (!raw.trim()) return 'Please select your district';
    if (!matchDistrict(raw, r.districts)) return 'Select a district from the list';
    return undefined;
  },
  area: (raw) => place(raw, 'area'),
  unit: (raw) => place(raw, 'unit'),
};

function place(raw: string, label: string) {
  const v = collapse(raw);
  if (!v) return `Please enter your ${label}`;
  if (v.length < 2) return 'Must be at least 2 characters';
  if (v.length > 100) return 'Must be at most 100 characters';
  if (!PLACE_RE.test(v)) return 'Use letters, numbers, spaces and . , \' ( ) & / - only';
  return undefined;
}

export function validateField(key: FieldKey, value: string, rules: Rules) {
  return validators[key](value, rules);
}

export function validateAll(values: FormValues, rules: Rules): Errors {
  const out: Errors = {};
  for (const key of Object.keys(validators) as FieldKey[]) {
    const e = validators[key](values[key], rules);
    if (e) out[key] = e;
  }
  return out;
}

// Character problems are shown while typing, before the field loses focus,
// so a digit or symbol in the name, or a letter in the mobile number, is
// flagged straight away. The typed text is left as it is.
export function instantError(key: FieldKey, value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (key === 'name' && /\p{N}/u.test(v)) return 'Name cannot contain numbers';
  if (key === 'name' && /[^\p{L}\p{M}\s]/u.test(v)) return NAME_SYMBOLS;
  if (key === 'age' && !/^\d+$/.test(v)) return 'Age must contain numbers only';
  if (key === 'mobile' && !DIGITS.test(v)) return 'Mobile number can contain digits only';
  return undefined;
}
