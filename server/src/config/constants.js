// Domain constants shared by models, validation and the workflow service.

// Registration workflow:
//   Submitted -> Confirmed -> entry pass generated -> entry pass sent
// The two pass steps are tracked in PASS_STATUS, separately from the
// registration status, so a failed WhatsApp send never loses a generated pass.
// "Awaiting confirmation" on the dashboard is only a label for SUBMITTED.
const STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
});

const STATUSES = Object.values(STATUS);

// Every allowed edge of the registration workflow. Anything not listed here
// is refused by the server, whatever the client sends.
//   action      - name used by the API (POST /registrations/:id/actions/:action)
//   permission  - see ROLE_PERMISSIONS
const TRANSITIONS = Object.freeze({
  confirm: { from: [STATUS.SUBMITTED], to: STATUS.CONFIRMED, permission: 'approve' },
});

const ROLES = Object.freeze({ ADMIN: 'admin', STAFF: 'staff' });

// admin: full control, including the conference website (content).
// staff: can view registrations and verify passes at the gate, but cannot
// confirm registrations, send passes or edit the website.
const ROLE_PERMISSIONS = Object.freeze({
  admin: ['view', 'approve', 'send', 'gate', 'content'],
  staff: ['view', 'gate'],
});

const AGE_MIN = 10;
const AGE_MAX = 100;

// Registration form versions. Version 1 is the original form (name, age,
// mobile, email, district, area, unit). Version 2 adds gender, place, a
// WhatsApp number and accompanying children. A submission without
// formVersion is read as version 1, so a form page opened before a deploy
// still works.
const FORM_VERSION = 2;

// Place is a new, separate field (Area and Unit keep their meaning).
// Proposed default pending confirmation (TEAM-LEAD-DECISIONS C2).
const PLACE_REQUIRED = true;

// Upper bounds for the admin-set form rules. The actual gender options, the
// maximum number of children and the allowed child ages are NOT decided here:
// admins set them in Website > Page content > Registration form. Until they
// are set, the gender and children questions are not shown or accepted.
const FORM_RULE_LIMITS = Object.freeze({
  genderOptionsMax: 6,
  childrenMax: 20,
  childAgeMax: 25,
});

const PASS_STATUS = Object.freeze({
  NONE: 'not_generated',
  GENERATED: 'generated',
  SENT: 'sent', // accepted by DXing; DXing gives no delivery receipt
  SEND_FAILED: 'send_failed',
});

const PASS_STATUSES = Object.values(PASS_STATUS);

// Notification templates. The key is stored on each notification record.
const TEMPLATE = Object.freeze({
  SUBMITTED: 'registration_submitted',
  CONFIRMED: 'registration_confirmed',
  PASS: 'entry_pass',
});

module.exports = {
  STATUS,
  STATUSES,
  TRANSITIONS,
  ROLES,
  ROLE_PERMISSIONS,
  AGE_MIN,
  AGE_MAX,
  FORM_VERSION,
  PLACE_REQUIRED,
  FORM_RULE_LIMITS,
  PASS_STATUS,
  PASS_STATUSES,
  TEMPLATE,
};
