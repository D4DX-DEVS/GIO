const { COUNTRIES, findCountry } = require('../config/countries');

const DIGITS = /^\d+$/;

/**
 * Checks a mobile number entered as a country code (picked from a list) and
 * a national number typed as digits only.
 *
 * Returns { e164 } on success, or { error } with a message for the user.
 * Nothing is stripped or rewritten to make invalid input pass: letters,
 * spaces, "+", "-" and other symbols are refused.
 */
function parseMobile(countryCode, number) {
  const country = findCountry(countryCode);
  if (!country) return { error: 'Select a country code from the list' };

  const raw = typeof number === 'number' ? String(number) : typeof number === 'string' ? number.trim() : '';
  if (!raw) return { error: 'Mobile number is required' };
  if (!DIGITS.test(raw)) return { error: 'Mobile number can contain digits only' };

  if (!country.lengths.includes(raw.length)) {
    return { error: `Enter a valid ${country.lengths.join(' or ')}-digit mobile number` };
  }
  if (!country.starts.includes(raw[0])) return { error: 'Enter a valid mobile number' };
  return { e164: `+${country.dial}${raw}` };
}

// DXing expects the number with country code and without "+".
function toProviderRecipient(e164) {
  return String(e164).replace(/\D/g, '');
}

// For admin lists: "+91 98765 43210"
function formatForDisplay(e164) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164 || '');
  if (m) return `+91 ${m[1]} ${m[2]}`;
  const value = String(e164 || '');
  // Longest matching code first so "+971" is not read as "+9" + "71".
  const country = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => value.startsWith(`+${c.dial}`));
  return country ? `+${country.dial} ${value.slice(country.dial.length + 1)}` : value;
}

module.exports = { parseMobile, toProviderRecipient, formatForDisplay };
