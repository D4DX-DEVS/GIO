// WhatsApp message wording. Edit the text here; event details come from the
// environment (EVENT_NAME, EVENT_DATE, EVENT_VENUE, SUPPORT_CONTACT).
const { env } = require('../config/env');
const { TEMPLATE } = require('../config/constants');

function eventLines() {
  const lines = [];
  if (env.event.date) lines.push(`Date: ${env.event.date}`);
  if (env.event.venue) lines.push(`Venue: ${env.event.venue}`);
  return lines;
}

function supportLine() {
  return env.event.supportContact ? `For any help, please contact ${env.event.supportContact}.` : '';
}

function join(parts) {
  return parts
    .filter((p) => p !== null && p !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const builders = {
  // Acknowledgement only: must not suggest the registration is confirmed.
  [TEMPLATE.SUBMITTED]: ({ registration: r }) =>
    join([
      `Dear ${r.name},`,
      '',
      `We have received your registration for *${env.event.name}*.`,
      `Registration number: *${r.regNo}*`,
      '',
      'Your registration is not confirmed yet. Our team will review your details and message you on this number once it is confirmed.',
      '',
      supportLine(),
    ]),

  [TEMPLATE.CONFIRMED]: ({ registration: r }) =>
    join([
      `Dear ${r.name},`,
      '',
      `We are pleased to inform you that your registration *${r.regNo}* for *${env.event.name}* is *confirmed*.`,
      ...(eventLines().length ? ['', ...eventLines()] : []),
      '',
      'Your entry pass will follow in the next message.',
      '',
      supportLine(),
    ]),

  // Caption sent with the entry pass image.
  [TEMPLATE.PASS]: ({ registration: r, pass }) =>
    join([
      `*Entry pass - ${env.event.name}*`,
      '',
      `Name: ${r.name}`,
      `Pass ID: *${pass.passId}*`,
      `Registration number: ${r.regNo}`,
      ...eventLines(),
      '',
      'Please show the QR code on this pass at the entrance. This pass is for you only; do not share it.',
    ]),
};

function buildText(template, context) {
  const builder = builders[template];
  if (!builder) throw new Error(`Unknown template: ${template}`);
  return builder(context);
}

module.exports = { buildText };
