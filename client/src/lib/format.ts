import type { PassStatus, Status } from './types';

export const STATUS_LABEL: Record<Status, string> = {
  submitted: 'Submitted',
  confirmed: 'Confirmed',
};

export const PASS_LABEL: Record<PassStatus, string> = {
  not_generated: 'No pass yet',
  generated: 'Pass generated',
  sent: 'Pass sent',
  send_failed: 'Pass send failed',
};

export const TEMPLATE_LABEL: Record<string, string> = {
  registration_submitted: 'Registration acknowledgement',
  registration_confirmed: 'Registration confirmation',
  entry_pass: 'Entry pass',
};

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const formatDate = (iso?: string | null) => (iso ? dateFmt.format(new Date(iso)) : '-');
export const formatDateTime = (iso?: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : '-');

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
