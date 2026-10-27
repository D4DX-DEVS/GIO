// Mobile number rules per country, from libphonenumber's mobile metadata.
// Mirrors server/src/utils/phone.js (same package and version), so the form
// and the server accept exactly the same numbers.
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/mobile';
import type { CountryCode } from 'libphonenumber-js/mobile';
import { Metadata } from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/mobile/metadata';

export type PhoneCountry = { iso: string; name: string; dial: string; lengths: number[] };

const DIGITS = /^\d+$/;

// NumberingPlan.type() exists at runtime but is missing from the package's typings.
type PlanWithTypes = { type(t: 'MOBILE'): { possibleLengths(): number[] } | undefined };

function mobileLengths(iso: string): number[] | null {
  const m = new Metadata(metadata);
  m.selectNumberingPlan(iso as CountryCode);
  const lengths = (m.numberingPlan as unknown as PlanWithTypes | undefined)?.type('MOBILE')?.possibleLengths();
  return lengths && lengths.length ? lengths : null;
}

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return (iso: string) => names.of(iso) ?? iso;
  } catch {
    return (iso: string) => iso;
  }
})();

/** Every country with mobile numbering rules, A-Z by name. */
export const COUNTRIES: PhoneCountry[] = getCountries()
  .flatMap((iso) => {
    const lengths = mobileLengths(iso);
    return lengths ? [{ iso: iso as string, name: regionName(iso), dial: getCountryCallingCode(iso) as string, lengths }] : [];
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

/** Listed first: where most registrants are. */
export const COMMON_COUNTRIES = ['IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH'].map((iso) => BY_ISO.get(iso)).filter((c): c is PhoneCountry => Boolean(c));

export const findCountry = (iso: string) => BY_ISO.get(iso);

/** "10", "9 or 10", "7 to 13" */
export function lengthText(lengths: number[]) {
  if (lengths.length > 2 && lengths[lengths.length - 1] - lengths[0] === lengths.length - 1) {
    return `${lengths[0]} to ${lengths[lengths.length - 1]}`;
  }
  return lengths.join(' or ');
}

/** Same rule as parseMobile in server/src/utils/phone.js: an error message, or undefined when valid. */
export function mobileError(raw: string, iso: string, kind: 'mobile' | 'WhatsApp' = 'mobile'): string | undefined {
  const v = raw.trim();
  if (!v) return kind === 'mobile' ? 'Please enter your phone number' : 'Please enter your WhatsApp number';
  if (!DIGITS.test(v)) return kind === 'mobile' ? 'Mobile number can contain digits only' : 'WhatsApp number can contain digits only';
  const country = BY_ISO.get(iso);
  if (!country) return 'Select a country from the list';
  if (!country.lengths.includes(v.length)) return `Enter a valid ${lengthText(country.lengths)}-digit ${kind} number`;
  const parsed = parsePhoneNumberFromString(v, iso as CountryCode);
  if (!parsed || !parsed.isValid() || parsed.nationalNumber !== v || parsed.countryCallingCode !== country.dial) {
    return `Enter a valid ${kind} number`;
  }
  return undefined;
}

/** E.164 form ("+919876543210") of a valid number, for comparing two numbers. */
export function toE164(raw: string, iso: string): string | null {
  if (mobileError(raw, iso)) return null;
  return parsePhoneNumberFromString(raw.trim(), iso as CountryCode)?.number ?? null;
}
