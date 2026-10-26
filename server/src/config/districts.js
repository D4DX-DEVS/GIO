// Districts offered in the registration form's district list. The server only
// accepts a district from this list.
//
// Override with DISTRICTS in server/.env (comma-separated), e.g.
//   DISTRICTS=North District,South District,East District
const { env } = require('./env');

const DEFAULT_DISTRICTS = [
  'Thiruvananthapuram',
  'Kollam',
  'Pathanamthitta',
  'Alappuzha',
  'Kottayam',
  'Idukki',
  'Ernakulam',
  'Thrissur',
  'Palakkad',
  'Malappuram',
  'Kozhikode',
  'Wayanad',
  'Kannur',
  'Kasaragod',
];

function districts() {
  return env.districts.length ? env.districts : DEFAULT_DISTRICTS;
}

/** Returns the canonical spelling of a listed district, or null. */
function matchDistrict(value) {
  const key = String(value).trim().toLocaleLowerCase('en');
  return districts().find((d) => d.toLocaleLowerCase('en') === key) ?? null;
}

module.exports = { districts, matchDistrict, DEFAULT_DISTRICTS };
