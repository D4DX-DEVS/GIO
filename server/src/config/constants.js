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

// admin: full control. staff: can view registrations and verify passes at
// the gate, but cannot confirm registrations or send passes.
const ROLE_PERMISSIONS = Object.freeze({
  admin: ['view', 'approve', 'send', 'gate'],
  staff: ['view', 'gate'],
});

const AGE_MIN = 10;
const AGE_MAX = 100;

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
  PASS_STATUS,
  PASS_STATUSES,
  TEMPLATE,
};
