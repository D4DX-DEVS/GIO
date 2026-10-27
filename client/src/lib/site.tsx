// Helpers for the public conference website.
import { Fragment } from 'react';
import type { PublicSite } from './types';

/**
 * Renders `*word*` as emphasis. Content is plain text: it is split into
 * React text nodes and never interpreted as HTML.
 */
export function Rich({ text }: { text: string }) {
  const parts = String(text || '').split('*');
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 && i < parts.length - 1 ? <em key={i}>{p}</em> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

export const plain = (s: string) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** Blank-line separated paragraphs. */
export function Paras({ text }: { text: string }) {
  return (
    <>
      {String(text || '')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </>
  );
}

/** Only http(s) links and the registration form become links. */
export function safeHref(url: string): string | null {
  if (url === '/register') return url;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function formatTime(t: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export function timeRange(start: string, end: string) {
  if (!start) return '';
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}

/**
 * Shown when the website content cannot be loaded (server unreachable, or
 * nothing published yet): the approved conference details and the logo and
 * poster supplied by GIO Keralam, so the page and Register Now still work.
 */
export const FALLBACK_SITE: PublicSite = {
  preview: false,
  registrationOpen: true,
  publishedAt: null,
  page: {
    presenter: 'GIO Keralam presents',
    title: 'International Conference on *Women*',
    intro: '',
    dateText: '15 November 2026',
    location: 'Ernakulam',
    venue: '',
    venueAddress: '',
    mapUrl: '',
    themeShort: 'Being, Becoming, Belonging',
    themeTitle: 'Being, *Becoming,* Belonging',
    themeSubtitle: 'Reimagining the Self, Space and Society',
    themeBody: '',
    aboutHeading: '',
    aboutBody: '',
    aboutImage: null,
    logo: { id: 'fallback-logo', url: '/brand/gio-logo-maroon.png', alt: 'GIO Keralam', caption: '', width: 600, height: 441 },
    poster: {
      id: 'fallback-poster',
      url: '/brand/poster.jpg',
      alt: 'Official poster of the International Conference on Women, 15 November 2026, Ernakulam',
      caption: '',
      width: 1200,
      height: 1600,
    },
    posterCaption: 'Official poster',
    posterTag: '15 Nov 2026',
    updatesHeading: '',
    programmeHeading: 'Programme',
    programmeIntro: '',
    speakersHeading: '',
    galleryHeading: '',
    faqHeading: '',
    regHeading: 'Register once. Your entry pass comes on WhatsApp.',
    regNote: '',
    phone: '',
    whatsapp: '',
    email: '',
    facebook: '',
    instagram: '',
    youtube: '',
    closingText: '15 November 2026, *Ernakulam*',
    footerText: 'International Conference on Women · GIO Keralam',
    show: { updates: false, theme: true, about: false, programme: true, speakers: false, gallery: false, faq: false, venue: true, contact: false },
    registrationOpen: true,
  },
  programme: [],
  speakers: [],
  announcements: [],
  faqs: [],
  gallery: [],
};
