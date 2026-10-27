// Mobile numbers: a country picked from a list and the national number typed
// as digits only. The allowed lengths and number ranges of each country come
// from libphonenumber's mobile metadata, the same data the form uses
// (client/src/lib/phone.ts), so both sides apply the same rules.
const { parsePhoneNumberFromString, isSupportedCountry, getCountryCallingCode } = require('libphonenumber-js/mobile');
const { Metadata } = require('libphonenumber-js/core');
const metadata = require('libphonenumber-js/mobile/metadata');

const DIGITS = /^\d+$/;

/** Allowed lengths of a mobile number in the country (without the country code), or null. */
function mobileLengths(iso) {
  if (typeof iso !== 'string' || !isSupportedCountry(iso)) return null;
  const m = new Metadata(metadata);
  m.selectNumberingPlan(iso);
  const lengths = m.numberingPlan.type('MOBILE')?.possibleLengths();
  return lengths && lengths.length ? lengths : null;
}

/** "10", "9 or 10", "7 to 13" */
function lengthText(lengths) {
  if (lengths.length > 2 && lengths[lengths.length - 1] - lengths[0] === lengths.length - 1) {
    return `${lengths[0]} to ${lengths[lengths.length - 1]}`;
  }
  return lengths.join(' or ');
}

/** Main country of a calling code ("91" -> "IN", "1" -> "US"), or null. */
function countryForDial(dial) {
  return metadata.country_calling_codes[String(dial)]?.[0] ?? null;
}

/**
 * Checks a mobile number entered as a country (ISO code such as "IN", picked
 * from a list) and a national number typed as digits only. `kind` is
 * "mobile" or "WhatsApp" and only changes the wording of errors.
 *
 * Returns { e164 } on success, or { error } with a message for the user.
 * Nothing is stripped or rewritten to make invalid input pass: letters,
 * spaces, "+", "-", a leading 0 and other symbols are refused.
 */
function parseMobile(iso, number, kind = 'mobile') {
  const lengths = mobileLengths(iso);
  if (!lengths) return { error: 'Select a country from the list' };

  const label = kind === 'mobile' ? 'Mobile number' : 'WhatsApp number';
  const raw = typeof number === 'number' ? String(number) : typeof number === 'string' ? number.trim() : '';
  if (!raw) return { error: `${label} is required` };
  if (!DIGITS.test(raw)) return { error: `${label} can contain digits only` };

  if (!lengths.includes(raw.length)) return { error: `Enter a valid ${lengthText(lengths)}-digit ${kind} number` };
  const parsed = parsePhoneNumberFromString(raw, iso);
  // nationalNumber differs from what was typed when libphonenumber dropped a
  // trunk prefix or read the digits as a country code; refuse those too.
  if (!parsed || !parsed.isValid() || parsed.nationalNumber !== raw || parsed.countryCallingCode !== getCountryCallingCode(iso)) {
    return { error: `Enter a valid ${kind} number` };
  }
  return { e164: parsed.number };
}

// For admin lists: "+91 98765 43210"
function formatForDisplay(e164) {
  const value = String(e164 || '');
  return parsePhoneNumberFromString(value)?.formatInternational() ?? value;
}

module.exports = { parseMobile, mobileLengths, countryForDial, formatForDisplay };
