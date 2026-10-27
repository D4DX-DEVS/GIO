// Registration form rules. These mirror server/src/services/validation.js for
// instant feedback; the server re-validates everything and has the final say.
// Nothing here changes what the user typed to make it pass.
import { mobileError } from './phone';

export type FormValues = {
  name: string;
  age: string;
  gender: string;
  place: string;
  district: string;
  area: string;
  unit: string;
  mobile: string;
  whatsapp: string;
  email: string;
};
export type FieldKey = keyof FormValues;
export type Child = { name: string; age: string };
export type Errors = Partial<
  Record<FieldKey | 'photo' | 'mobileCountry' | 'whatsappCountry' | 'childrenCount' | `children.${number}.name` | `children.${number}.age`, string>
>;

// The form asks for the national number only; the country of each number is
// picked from a list (ISO code such as "IN").
export type Rules = {
  ageMin: number;
  ageMax: number;
  districts: string[];
  mobileCountry: string;
  whatsappCountry: string;
  // Set by admins; an empty list means the question is not asked.
  genderOptions: string[];
  placeRequired: boolean;
  children: { max: number; ageMin: number; ageMax: number };
  // "Same as phone number" ticked: the WhatsApp field is not used.
  sameAsMobile: boolean;
};

// Letters (any script, with their combining marks) and single spaces only.
const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const PLACE_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'()&/-]*$/u;
// Same pattern zod uses for z.string().email() on the server.
const EMAIL_RE = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;
const DIGITS = /^\d+$/;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function matchDistrict(value: string, districts: string[]) {
  const key = value.trim().toLocaleLowerCase('en');
  return districts.find((d) => d.toLocaleLowerCase('en') === key) ?? null;
}

const NAME_SYMBOLS = 'Name can contain only letters and spaces (no numbers or special characters)';

function nameError(raw: string, empty: string) {
  const v = collapse(raw);
  if (!v) return empty;
  if (/\p{N}/u.test(v)) return 'Name cannot contain numbers';
  if (!NAME_RE.test(v)) return NAME_SYMBOLS;
  if (v.length < 2) return 'Name must be at least 2 characters';
  if (v.length > 120) return 'Name must be at most 120 characters';
  return undefined;
}

const validators: Record<FieldKey, (v: string, r: Rules) => string | undefined> = {
  name: (raw) => nameError(raw, 'Please enter your name'),
  age(raw, r) {
    const v = raw.trim();
    if (!v) return 'Please enter your age';
    if (!/^\d+$/.test(v)) return 'Age must contain numbers only';
    if (v.length > 3 || +v < r.ageMin || +v > r.ageMax) return `Age must be between ${r.ageMin} and ${r.ageMax}`;
    return undefined;
  },
  gender(raw, r) {
    if (!r.genderOptions.length) return undefined;
    return raw ? undefined : 'Please select an option';
  },
  place(raw, r) {
    if (!r.placeRequired && !raw.trim()) return undefined;
    return place(raw, 'place');
  },
  district(raw, r) {
    if (!raw.trim()) return 'Please select your district';
    if (!matchDistrict(raw, r.districts)) return 'Select a district from the list';
    return undefined;
  },
  // Optional: checked only when something is typed.
  area: (raw) => (raw.trim() ? place(raw, 'area') : undefined),
  unit: (raw) => (raw.trim() ? place(raw, 'unit') : undefined),
  mobile(raw, r) {
    return mobileError(raw, r.mobileCountry);
  },
  whatsapp(raw, r) {
    if (r.sameAsMobile) return undefined;
    return mobileError(raw, r.whatsappCountry, 'WhatsApp');
  },
  email(raw) {
    const v = raw.trim();
    if (!v) return 'Please enter your email address';
    if (v.length > 200 || !EMAIL_RE.test(v)) return 'Enter a valid email address, e.g. name@example.com';
    return undefined;
  },
};

export const FIELD_ORDER = Object.keys(validators) as FieldKey[];

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

export const childNameError = (raw: string) => nameError(raw, 'Please enter the name');

export function childAgeError(raw: string, rules: Rules): string | undefined {
  const c = rules.children;
  const v = raw.trim();
  if (!v) return 'Please enter the age';
  if (!/^\d+$/.test(v)) return 'Age must contain numbers only';
  if (v.length > 2 || +v < c.ageMin || +v > c.ageMax) return `Age must be between ${c.ageMin} and ${c.ageMax}`;
  return undefined;
}

/** The typed number of children, or an error. */
export function childrenCountError(raw: string, rules: Rules): string | undefined {
  const v = raw.trim();
  if (!v) return undefined; // empty means none
  if (!/^\d+$/.test(v)) return 'Enter the number of children as a whole number';
  if (+v > rules.children.max) return `At most ${rules.children.max} accompanying children`;
  return undefined;
}

export function validateAll(values: FormValues, childrenCount: string, children: Child[], rules: Rules): Errors {
  const out: Errors = {};
  for (const key of FIELD_ORDER) {
    const e = validators[key](values[key], rules);
    if (e) out[key] = e;
  }
  const countErr = childrenCountError(childrenCount, rules);
  if (countErr) out.childrenCount = countErr;
  children.forEach((c, i) => {
    const n = childNameError(c.name);
    if (n) out[`children.${i}.name`] = n;
    const a = childAgeError(c.age, rules);
    if (a) out[`children.${i}.age`] = a;
  });
  return out;
}

// Character problems are shown while typing, before the field loses focus,
// so a digit or symbol in the name, or a letter in a phone number, is
// flagged straight away. The typed text is left as it is.
export function instantError(key: FieldKey, value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (key === 'name' && /\p{N}/u.test(v)) return 'Name cannot contain numbers';
  if (key === 'name' && /[^\p{L}\p{M}\s]/u.test(v)) return NAME_SYMBOLS;
  if (key === 'age' && !/^\d+$/.test(v)) return 'Age must contain numbers only';
  if (key === 'mobile' && !DIGITS.test(v)) return 'Mobile number can contain digits only';
  if (key === 'whatsapp' && !DIGITS.test(v)) return 'WhatsApp number can contain digits only';
  return undefined;
}
