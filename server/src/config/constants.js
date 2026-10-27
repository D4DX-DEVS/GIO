// Domain constants shared by models, validation and the registration service.

// Registration workflow: a submission is confirmed automatically and its
// entry pass is generated straight away, so the registrant sees the pass on
// the success page. "submitted" only remains on registrations made before
// that change; an admin can generate their pass from the dashboard, which
// confirms them.
const STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
});

const STATUSES = Object.values(STATUS);

const ROLES = Object.freeze({ ADMIN: 'admin', STAFF: 'staff' });

// admin: full control, including the conference website (content).
// staff: can view registrations and verify passes at the gate, but cannot
// generate passes or edit the website.
const ROLE_PERMISSIONS = Object.freeze({
  admin: ['view', 'approve', 'send', 'gate', 'content'],
  staff: ['view', 'gate'],
});

const AGE_MIN = 10;
const AGE_MAX = 100;

// Registration form versions. Version 1 is the original form (name, age,
// mobile, email, district, area, unit). Version 2 added gender, place, a
// WhatsApp number and children's ages. Version 3 (current) makes Area and
// Unit optional, asks for a country for each phone number and a name and age
// for each child. A submission without formVersion is read as version 1;
// version 2 pages are asked to reload.
const FORM_VERSION = 3;

// Place is a new, separate field (Area and Unit keep their meaning).
// Proposed default pending confirmation (TEAM-LEAD-DECISIONS C2).
const PLACE_REQUIRED = true;

// Upper bounds for the admin-set form rules. The gender options are set by
// admins in Website > Page content > Registration form; until they are, the
// gender question is not shown or accepted.
const FORM_RULE_LIMITS = Object.freeze({
  genderOptionsMax: 6,
  childrenMax: 20,
  childAgeMax: 25,
});

// The accompanying children question is always asked. These limits apply
// until an admin sets their own in Website > Page content > Registration form.
const CHILDREN_DEFAULTS = Object.freeze({ max: 10, ageMin: 0, ageMax: 17 });

// "sent" and "send_failed" only remain on registrations from when passes
// were sent on WhatsApp; both mean the pass exists.
const PASS_STATUS = Object.freeze({
  NONE: 'not_generated',
  GENERATED: 'generated',
  SENT: 'sent',
  SEND_FAILED: 'send_failed',
});

const PASS_STATUSES = Object.values(PASS_STATUS);

module.exports = {
  STATUS,
  STATUSES,
  ROLES,
  ROLE_PERMISSIONS,
  AGE_MIN,
  AGE_MAX,
  FORM_VERSION,
  PLACE_REQUIRED,
  FORM_RULE_LIMITS,
  CHILDREN_DEFAULTS,
  PASS_STATUS,
  PASS_STATUSES,
};
