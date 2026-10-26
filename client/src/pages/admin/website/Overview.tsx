// Website > Overview: every section of the landing page in one list, with
// what visitors see right now, how much content is published or still in
// draft, and a direct way to edit it or add new content.
import { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  HelpCircle,
  ImageIcon,
  Images,
  Info,
  MapPin,
  Megaphone,
  Mic,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { api, errorMessage } from '../../../lib/api';
import type { ContentItem, ItemKind, LibraryImage, PageSettings, SectionKey, SettingsResponse } from '../../../lib/types';
import { formatDateTime } from '../../../lib/format';
import { Alert, Button, Skeleton, cx } from '../../../components/ui';
import { StatusPill } from '../../../components/website';

type Counts = { published: number; drafts: number; changed: number };
type Data = { settings: SettingsResponse; items: Record<ItemKind, ContentItem[]>; images: number };

const KINDS: ItemKind[] = ['programme', 'speaker', 'announcement', 'faq', 'gallery'];

const count = (items: ContentItem[]): Counts => ({
  published: items.filter((i) => i.status !== 'draft').length,
  drafts: items.filter((i) => i.status === 'draft').length,
  changed: items.filter((i) => i.status === 'changed').length,
});

type Row = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  /** Switch in "Sections shown"; rows without one always show. */
  show?: SectionKey;
  /** List of items behind this section. */
  kind?: ItemKind;
  /** Optional sections stay off the website until something is published. */
  needsItems?: boolean;
  edit: string;
  add?: { to: string; label: string };
  summary: (p: PageSettings, c?: Counts) => string;
};

const contactLines = (p: PageSettings) => [p.phone, p.whatsapp, p.email, p.facebook, p.instagram, p.youtube].filter(Boolean).length;

const ROWS: Row[] = [
  {
    key: 'hero',
    label: 'Hero and event details',
    icon: Sparkles,
    description: 'Title, theme line, date, location, poster and the Register Now button.',
    edit: '/admin/website#pc-conference',
    summary: (p) => [p.dateText, p.location].filter(Boolean).join(' · ') || 'Date and location not filled in',
  },
  {
    key: 'updates',
    label: 'Announcements',
    icon: Megaphone,
    description: 'News and updates. A pinned announcement also appears above the header.',
    show: 'updates',
    kind: 'announcement',
    needsItems: true,
    edit: '/admin/website/announcements',
    add: { to: '/admin/website/announcements?add=1', label: 'Add announcement' },
    summary: () => '',
  },
  {
    key: 'about',
    label: 'About the conference',
    icon: Info,
    description: 'A heading, text and an optional image.',
    show: 'about',
    edit: '/admin/website#pc-about',
    summary: (p) => (p.aboutBody ? `${p.aboutBody.trim().split(/\s+/).length} words` : 'No text yet: the section stays hidden'),
  },
  {
    key: 'theme',
    label: 'Theme',
    icon: FileText,
    description: 'The theme as a large editorial spread, with its subtitle and description.',
    show: 'theme',
    edit: '/admin/website#pc-theme',
    summary: (p) => p.themeTitle.replace(/\*/g, '') || 'No theme heading',
  },
  {
    key: 'programme',
    label: 'Programme',
    icon: CalendarClock,
    description: 'Sessions and breaks in time order.',
    show: 'programme',
    kind: 'programme',
    edit: '/admin/website/programme',
    add: { to: '/admin/website/programme?add=1', label: 'Add session' },
    summary: (_p, c) => (c && c.published ? '' : 'Shows “Programme will be announced soon.”'),
  },
  {
    key: 'speakers',
    label: 'Speakers',
    icon: Mic,
    description: 'Name, designation, photo and biography.',
    show: 'speakers',
    kind: 'speaker',
    needsItems: true,
    edit: '/admin/website/speakers',
    add: { to: '/admin/website/speakers?add=1', label: 'Add speaker' },
    summary: () => '',
  },
  {
    key: 'gallery',
    label: 'Gallery',
    icon: ImageIcon,
    description: 'Photos from the image library.',
    show: 'gallery',
    kind: 'gallery',
    needsItems: true,
    edit: '/admin/website/gallery',
    add: { to: '/admin/website/gallery?add=1', label: 'Add image' },
    summary: () => '',
  },
  {
    key: 'reg',
    label: 'How registration works',
    icon: UserPlus,
    description: 'Three steps and a Register Now button. Always shown.',
    edit: '/admin/website#pc-headings',
    summary: (p) => (p.registrationOpen ? 'Registration open' : 'Registration closed'),
  },
  {
    key: 'faq',
    label: 'Frequently asked questions',
    icon: HelpCircle,
    description: 'Questions and answers, in the order you set.',
    show: 'faq',
    kind: 'faq',
    needsItems: true,
    edit: '/admin/website/faqs',
    add: { to: '/admin/website/faqs?add=1', label: 'Add question' },
    summary: () => '',
  },
  {
    key: 'venue',
    label: 'Venue',
    icon: MapPin,
    description: 'Venue name, address and map link.',
    show: 'venue',
    edit: '/admin/website#pc-venue',
    summary: (p) => p.venue || `${p.location ? `${p.location}: ` : ''}“Full venue details will be announced.”`,
  },
  {
    key: 'contact',
    label: 'Contact',
    icon: Phone,
    description: 'Phone, WhatsApp, email and social links.',
    show: 'contact',
    edit: '/admin/website#pc-contact',
    summary: (p) => {
      const n = contactLines(p);
      return n ? `${n} contact line${n === 1 ? '' : 's'}` : 'No contact details yet';
    },
  },
  {
    key: 'closing',
    label: 'Closing band and footer',
    icon: Flag,
    description: 'Final call to action and the footer line. Always shown.',
    edit: '/admin/website#pc-closing',
    summary: (p) => p.closingText.replace(/\*/g, '') || 'No closing line: the band is hidden',
  },
];

type Visibility = { tone: 'live' | 'off' | 'waiting' | 'never'; label: string };

const TONES: Record<Visibility['tone'], string> = {
  live: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
  off: 'bg-slate-100 text-slate-600 ring-slate-200',
  waiting: 'bg-amber-50 text-amber-800 ring-amber-200/80',
  never: 'bg-sky-50 text-sky-800 ring-sky-200/80',
};

function visibility(row: Row, published: PageSettings | null, c?: Counts): Visibility {
  if (!published) return { tone: 'never', label: 'Site not published' };
  if (row.show && !published.show[row.show]) return { tone: 'off', label: 'Hidden' };
  if (row.needsItems && c && !c.published) return { tone: 'waiting', label: 'Waiting for content' };
  if (row.key === 'about' && !published.aboutBody && !published.aboutImage) return { tone: 'waiting', label: 'Waiting for content' };
  if (row.key === 'contact' && !contactLines(published)) return { tone: 'waiting', label: 'Waiting for content' };
  if (row.key === 'closing' && !published.closingText) return { tone: 'off', label: 'Hidden' };
  return { tone: 'live', label: 'Live' };
}

export default function Overview() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    Promise.all([
      api<SettingsResponse>('/api/admin/website/settings'),
      Promise.all(KINDS.map((k) => api<{ items: ContentItem[] }>(`/api/admin/website/items/${k}`).then((r) => r.items))),
      api<{ assets: LibraryImage[] }>('/api/admin/website/assets').then((r) => r.assets.length),
    ])
      .then(([settings, lists, images]) =>
        setData({ settings, items: Object.fromEntries(KINDS.map((k, i) => [k, lists[i]])) as Record<ItemKind, ContentItem[]>, images })
      )
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <Alert title="The website overview could not be loaded" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>
          {error}
        </Alert>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl space-y-4 px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7" aria-busy>
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </main>
    );
  }

  const { settings } = data;
  const page = settings.draft;
  const published = settings.published;
  const status = !published ? 'draft' : settings.hasUnpublishedChanges ? 'changed' : 'published';
  const counts = Object.fromEntries(KINDS.map((k) => [k, count(data.items[k])])) as Record<ItemKind, Counts>;
  const live = ROWS.filter((r) => visibility(r, published, r.kind && counts[r.kind]).tone === 'live').length;

  const stats: Array<[string, string, string, string]> = [
    ['Sections live', `${live} / ${ROWS.length}`, 'on the landing page', '#sections'],
    ['Programme', String(counts.programme.published), `${counts.programme.drafts} draft${counts.programme.drafts === 1 ? '' : 's'}`, '/admin/website/programme'],
    ['Speakers', String(counts.speaker.published), `${counts.speaker.drafts} draft${counts.speaker.drafts === 1 ? '' : 's'}`, '/admin/website/speakers'],
    ['Images', String(data.images), 'in the library', '/admin/website/images'],
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      {/* Landing page status */}
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            Landing page <StatusPill status={status} />
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {settings.publishedAt
              ? `Published ${formatDateTime(settings.publishedAt)} by ${settings.publishedByName}.`
              : 'Not published yet. Visitors see the approved conference details, the logo and the poster.'}
            {settings.hasUnpublishedChanges && published && ' Saved changes are waiting to be published.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="btn-line inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold"
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> View website
          </a>
          <a
            href="/?preview=1"
            target="_blank"
            rel="noreferrer"
            className="btn-line inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold"
          >
            <Eye className="h-4 w-4" aria-hidden /> Preview drafts
          </a>
          <Link
            to="/admin/website"
            className="btn-primary inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold"
          >
            <Pencil className="h-4 w-4" aria-hidden /> Edit page content
          </Link>
        </div>
      </div>

      {/* Numbers */}
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, big, small, to]) => (
          <li key={label}>
            {to.startsWith('#') ? (
              <a href={to} className="card block h-full p-4 transition hover:border-slate-300">
                <Stat label={label} big={big} small={small} />
              </a>
            ) : (
              <Link to={to} className="card block h-full p-4 transition hover:border-slate-300">
                <Stat label={label} big={big} small={small} />
              </Link>
            )}
          </li>
        ))}
      </ul>

      {/* Sections */}
      <section id="sections" className="card mt-4 scroll-mt-24 overflow-hidden" aria-labelledby="sections-title">
        <div className="border-b border-slate-100 p-5">
          <h2 id="sections-title" className="display text-2xl">
            Sections on the landing page
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            In the order visitors see them. Optional sections appear only when they are switched on and have published content.
          </p>
        </div>
        <ol className="divide-y divide-slate-100">
          {ROWS.map((row) => {
            const c = row.kind ? counts[row.kind] : undefined;
            const vis = visibility(row, published, c);
            const switchChanged = Boolean(row.show && published && published.show[row.show] !== page.show[row.show]);
            const summary = row.summary(page, c);
            return (
              <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 sm:flex">
                  <row.icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{row.label}</span>
                    <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONES[vis.tone])}>{vis.label}</span>
                    {switchChanged && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-200/80">
                        Will be {page.show[row.show!] ? 'shown' : 'hidden'} after publishing
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">{row.description}</p>
                  {(c || summary) && (
                    <p className="mt-1 text-[13px] font-medium text-slate-600">
                      {c && (
                        <>
                          {c.published} published · {c.drafts} draft{c.drafts === 1 ? '' : 's'}
                          {c.changed > 0 && ` · ${c.changed} with unpublished changes`}
                        </>
                      )}
                      {c && summary && ' · '}
                      {summary}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {row.add && (
                    <Link
                      to={row.add.to}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-brand-50 px-3 text-[13px] font-semibold text-brand-700 hover:bg-brand-100"
                    >
                      <Plus className="h-4 w-4" aria-hidden /> {row.add.label}
                    </Link>
                  )}
                  <Link
                    to={row.edit}
                    aria-label={`Edit ${row.label}`}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 p-4 text-sm text-slate-600 sm:px-5">
          <span>Switch sections on or off in Page content.</span>
          <Link to="/admin/website#pc-sections" className="font-semibold text-brand-700 hover:underline">
            Sections shown →
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="card mt-4 p-5" aria-labelledby="flow-title">
        <h2 id="flow-title" className="display text-2xl">
          How a change reaches the website
        </h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ['Add or edit', 'New items and saved page changes start as drafts. Visitors do not see drafts.'],
            ['Preview', 'Preview drafts opens the website with drafts and hidden sections outlined.'],
            ['Publish', 'Published content shows on the next page load. No rebuild or developer needed.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="font-serif text-2xl italic text-brand-600">{i + 1}.</span>
              <p className="mt-1 text-sm font-semibold text-slate-900">{t}</p>
              <p className="mt-0.5 text-sm text-slate-500">{d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <Images className="h-4 w-4" aria-hidden /> Upload only images GIO Keralam has the right to publish, and get speakers’ consent before publishing their photos.
        </p>
      </section>
    </main>
  );
}

function Stat({ label, big, small }: { label: string; big: string; small: string }) {
  return (
    <>
      <span className="kicker block">{label}</span>
      <span className="display mt-1 block text-4xl">{big}</span>
      <span className="block text-xs text-slate-500">{small}</span>
    </>
  );
}
