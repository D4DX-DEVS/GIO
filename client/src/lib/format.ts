import type { Status } from './types';

export const STATUS_LABEL: Record<Status, string> = {
  submitted: 'Submitted',
  confirmed: 'Confirmed',
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

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
/** "9:42:15 am": check-in and check-out times, to the second. */
export const formatTime = (iso?: string | null) => (iso ? timeFmt.format(new Date(iso)) : '-');
/** "9:42:15 am, 15 Nov 2026" */
export const formatScanTime = (iso?: string | null) => (iso ? `${formatTime(iso)}, ${formatDate(iso)}` : '-');

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
