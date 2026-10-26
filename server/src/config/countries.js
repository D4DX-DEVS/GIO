// Country codes offered next to the mobile number field. The number itself is
// entered as digits only; the country code is picked from this list, so the
// number input never needs "+" or other symbols.
//
//   dial    - country calling code (digits, no "+")
//   lengths - allowed lengths of the national number (without the country code)
//   starts  - allowed first digits of a mobile number in that country
const COUNTRIES = Object.freeze([
  { dial: '91', iso: 'IN', name: 'India', lengths: [10], starts: '6789' },
  { dial: '971', iso: 'AE', name: 'United Arab Emirates', lengths: [9], starts: '5' },
  { dial: '966', iso: 'SA', name: 'Saudi Arabia', lengths: [9], starts: '5' },
  { dial: '974', iso: 'QA', name: 'Qatar', lengths: [8], starts: '3567' },
  { dial: '968', iso: 'OM', name: 'Oman', lengths: [8], starts: '79' },
  { dial: '965', iso: 'KW', name: 'Kuwait', lengths: [8], starts: '569' },
  { dial: '973', iso: 'BH', name: 'Bahrain', lengths: [8], starts: '36' },
  { dial: '60', iso: 'MY', name: 'Malaysia', lengths: [9, 10], starts: '1' },
  { dial: '65', iso: 'SG', name: 'Singapore', lengths: [8], starts: '89' },
  { dial: '44', iso: 'GB', name: 'United Kingdom', lengths: [10], starts: '7' },
  { dial: '1', iso: 'US', name: 'United States / Canada', lengths: [10], starts: '23456789' },
]);

function findCountry(dial) {
  return COUNTRIES.find((c) => c.dial === String(dial)) ?? null;
}

module.exports = { COUNTRIES, findCountry };
