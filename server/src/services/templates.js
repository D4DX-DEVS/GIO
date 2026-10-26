// WhatsApp message wording. Edit the text here. Event details come from the
// published website settings, or from EVENT_NAME, EVENT_DATE, EVENT_VENUE and
// SUPPORT_CONTACT until those are published (services/site.js getEvent).
const { env } = require('../config/env');
const { TEMPLATE } = require('../config/constants');

function eventLines(event) {
  const lines = [];
  if (event.date) lines.push(`Date: ${event.date}`);
  if (event.venue) lines.push(`Venue: ${event.venue}`);
  return lines;
}

function supportLine(event) {
  return event.supportContact ? `For any help, please contact ${event.supportContact}.` : '';
}

/**
 * Number of accompanying children, or null when not recorded (registrations
 * from the original form). A pass carries the count frozen at issue.
 */
function childrenCount(registration, pass) {
  if (pass?.holder && typeof pass.holder.childrenCount === 'number') return pass.holder.childrenCount;
  return Array.isArray(registration.children) ? registration.children.length : null;
}

const childrenLine = (n) => (n > 0 ? `Accompanying children: ${n}` : null);

function join(parts) {
  return parts
    .filter((p) => p !== null && p !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const builders = {
  // Acknowledgement only: must not suggest the registration is confirmed.
  [TEMPLATE.SUBMITTED]: ({ registration: r, event }) =>
    join([
      `Dear ${r.name},`,
      '',
      `We have received your registration for *${event.name}*.`,
      `Registration number: *${r.regNo}*`,
      '',
      'Your registration is not confirmed yet. Our team will review your details and message you on this number once it is confirmed.',
      '',
      supportLine(event),
    ]),

  [TEMPLATE.CONFIRMED]: ({ registration: r, event }) =>
    join([
      `Dear ${r.name},`,
      '',
      `We are pleased to inform you that your registration *${r.regNo}* for *${event.name}* is *confirmed*.`,
      ...(eventLines(event).length ? ['', ...eventLines(event)] : []),
      childrenLine(childrenCount(r)),
      '',
      'Your entry pass will follow in the next message.',
      '',
      supportLine(event),
    ]),

  // Caption sent with the entry pass image.
  [TEMPLATE.PASS]: ({ registration: r, pass, event }) => {
    const n = childrenCount(r, pass);
    return join([
      `*Entry pass - ${event.name}*`,
      '',
      `Name: ${r.name}`,
      `Pass ID: *${pass.passId}*`,
      `Registration number: ${r.regNo}`,
      childrenLine(n),
      ...eventLines(event),
      '',
      n > 0
        ? `Please show the QR code on this pass at the entrance. This pass is for you and your ${n} accompanying ${n === 1 ? 'child' : 'children'}; do not share it.`
        : 'Please show the QR code on this pass at the entrance. This pass is for you only; do not share it.',
    ]);
  },
};

function buildText(template, context) {
  const builder = builders[template];
  if (!builder) throw new Error(`Unknown template: ${template}`);
  return builder({ event: env.event, ...context });
}

module.exports = { buildText, childrenCount };
