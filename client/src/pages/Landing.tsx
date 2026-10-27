// Public conference website. Content comes from the published website
// settings (GET /api/public/site). Admins can open /?preview=1 to see drafts
// and hidden sections, outlined. Optional sections stay hidden until they
// have published content.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Download, FileText, MapPin, Network, Play, QrCode, UserRound, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '../site.css';
import { api, ApiError } from '../lib/api';
import type { ItemStatus, PublicSite, SectionKey } from '../lib/types';
import { FALLBACK_SITE, Paras, Rich, initialsOf, plain, safeHref, timeRange } from '../lib/site';
import { BackToTop, LeafMark, SiteHeader } from '../components/SiteChrome';

type State = { site: PublicSite; source: 'live' | 'fallback' | 'preview'; previewError?: string };

function useSite(preview: boolean) {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const publicSite = () =>
      api<PublicSite>('/api/public/site', { signal: ctrl.signal })
        .then((site) => ({ site, source: 'live' as const }))
        // Not published yet, or the server is unreachable: show the approved details.
        .catch((err) => {
          if ((err as Error).name === 'AbortError') throw err;
          return { site: FALLBACK_SITE, source: 'fallback' as const };
        });
    const load = preview
      ? api<PublicSite>('/api/admin/website/preview', { signal: ctrl.signal })
          .then((site) => ({ site, source: 'preview' as const }))
          .catch(async (err) => {
            if ((err as Error).name === 'AbortError') throw err;
            const reason = err instanceof ApiError && (err.status === 401 || err.status === 403) ? 'Sign in as an admin to preview drafts.' : 'The preview could not be loaded.';
            return { ...(await publicSite()), previewError: reason };
          })
      : publicSite();
    load.then(setState).catch(() => {});
    return () => ctrl.abort();
  }, [preview]);
  return state;
}

/**
 * Reveals content as it scrolls into view: `.rv` fades up, `.rv-kids` staggers
 * its children and `.rv-art` slides its background art in. Only elements
 * still below the fold are hidden first, and nothing is hidden with reduced
 * motion or without IntersectionObserver, so content is never held back.
 */
function useReveal(ready: boolean) {
  useEffect(() => {
    if (!ready || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }
    );
    document.querySelectorAll<HTMLElement>('.site .rv, .site .rv-kids, .site .rv-art').forEach((el) => {
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add('rv-on');
        io.observe(el);
      }
    });
    return () => io.disconnect();
  }, [ready]);
}

/** True once the element has scrolled above the viewport. */
function usePassed(ref: RefObject<HTMLElement>, ready: boolean) {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!ready || !el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setPassed(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [ref, ready]);
  return passed;
}

const DraftTag = ({ status, label }: { status?: ItemStatus; label?: string }) =>
  label || (status && status !== 'published') ? <span className="draft-tag">{label ?? (status === 'changed' ? 'Unpublished changes' : 'Draft')}</span> : null;

const draftCls = (status?: ItemStatus) => (status && status !== 'published' ? 'is-draft' : undefined);

/** Leaf artwork cut from the approved design, at the edges of a band. */
function Art({ left, right, lazy = true }: { left?: string; right?: string; lazy?: boolean }) {
  const load = lazy ? ('lazy' as const) : undefined;
  return (
    <>
      {left && <img className="art art-l" src={`/brand/bg/${left}.webp`} alt="" aria-hidden="true" loading={load} decoding="async" />}
      {right && <img className="art art-r" src={`/brand/bg/${right}.webp`} alt="" aria-hidden="true" loading={load} decoding="async" />}
    </>
  );
}

/** Light band with the section name in a left column. */
function Section({ id, label, hidden, tag, art, children }: { id: string; label: string; hidden?: boolean; tag?: string; art?: boolean; children: ReactNode }) {
  return (
    <section className={`sec${art ? ' rv-art' : ''}${hidden ? ' is-draft' : ''}`} id={id} aria-labelledby={`${id}-label`}>
      {art && <Art left="theme-left" right="theme-right" />}
      <div className="wrap sec-grid">
        <p className="sec-label" id={`${id}-label`}>
          {label}
          {tag && <span className="draft-tag">{tag}</span>}
        </p>
        <div className="rv">{children}</div>
      </div>
    </section>
  );
}

function RegisterButton({ open, className = '', large }: { open: boolean; className?: string; large?: boolean }) {
  if (!open) {
    return (
      <span className={`btn is-closed ${className}`} aria-disabled="true">
        Registrations closed
      </span>
    );
  }
  return (
    <Link to="/register" className={`btn btn-reg ${large ? 'lg' : ''} ${className}`}>
      Register now <span className="arr" aria-hidden="true">→</span>
    </Link>
  );
}

function LoadingPage() {
  return (
    <div className="site" aria-busy="true">
      <div className="band-hdr">
        <div className="wrap band-hdr-in" style={{ minHeight: 96 }} />
      </div>
      <div className="hdr">
        <div className="wrap hdr-in">
          <span className="sk" style={{ width: 280, maxWidth: '60%', height: 14 }} />
        </div>
      </div>
      <div className="hero">
        <div className="wrap">
          <span className="sk" style={{ width: 160, height: 12, marginBottom: 20 }} />
          <span className="sk" style={{ width: '80%', maxWidth: 520, height: 56, marginBottom: 12 }} />
          <span className="sk" style={{ width: '55%', maxWidth: 360, height: 56 }} />
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading…
      </span>
    </div>
  );
}

/** "Being, Becoming, Belonging" becomes separate words; anything else stays one line. */
function themeWords(title: string) {
  const parts = plain(title)
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  return parts.length >= 2 && parts.length <= 4 && parts.every((w) => w.split(/\s+/).length <= 2) ? parts : null;
}

/** "15 November 2026" -> "15" over "November 2026"; other formats stay whole. */
function splitDate(text: string) {
  const m = /^(\d{1,2}(?:\s*[–-]\s*\d{1,2})?)\s+(.+)$/.exec(text.trim());
  return m ? { big: m[1], rest: m[2] } : { big: text, rest: '' };
}

const POSTERS = [
  { src: '/brand/poster-1.jpg', alt: 'Conference poster with an illustration of women: International Conference on Women, 15 November 2026, Ernakulam' },
  { src: '/brand/poster-2.jpg', alt: 'Conference poster: International Conference on Women, 15 November 2026, Ernakulam' },
];

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Hero poster carousel. Slides sit in a scroll-snap track, so touch swipe
 * works natively and the arrows and dots just scroll it. It advances every
 * 6 seconds until a visitor uses it, pauses on hover or focus, and never
 * moves on its own with reduced motion.
 */
function PosterSlider({ posters }: { posters: Array<{ src: string; alt: string }> }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const trackId = useId();
  const n = posters.length;

  const go = useCallback(
    (i: number) => {
      const el = track.current;
      if (el) el.scrollTo({ left: ((i + n) % n) * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
    [n]
  );
  const choose = (i: number) => {
    setAuto(false);
    go(i);
  };

  useEffect(() => {
    if (!auto || paused || n < 2 || reducedMotion()) return undefined;
    const t = window.setTimeout(() => go(index + 1), 6000);
    return () => window.clearTimeout(t);
  }, [auto, paused, index, n, go]);

  return (
    <div
      className="poster"
      role="region"
      aria-roledescription="carousel"
      aria-label="Conference posters"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="poster-stage">
        <div
          className="poster-track"
          id={trackId}
          ref={track}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          onPointerDown={() => setAuto(false)}
        >
          {posters.map((poster, i) => (
            <div key={poster.src} className={`poster-slide${i === index ? ' on' : ''}`} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`}>
              <img src={poster.src} alt={poster.alt} width={720} height={960} decoding="async" draggable={false} />
            </div>
          ))}
        </div>
        {n > 1 && (
          <>
            <button type="button" className="poster-arrow prev" aria-controls={trackId} aria-label="Previous poster" onClick={() => choose(index - 1)}>
              <ChevronLeft aria-hidden="true" strokeWidth={1.75} />
            </button>
            <button type="button" className="poster-arrow next" aria-controls={trackId} aria-label="Next poster" onClick={() => choose(index + 1)}>
              <ChevronRight aria-hidden="true" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="poster-dots">
          {posters.map((poster, i) => (
            <button
              key={poster.src}
              type="button"
              className={i === index ? 'on' : undefined}
              aria-controls={trackId}
              aria-label={`Show poster ${i + 1}`}
              aria-current={i === index || undefined}
              onClick={() => choose(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const PILLARS: Array<[LucideIcon, string]> = [
  [Users, 'Thoughtful Sessions'],
  [UserRound, 'Inspiring Speakers'],
  [BookOpen, 'Meaningful Dialogues'],
  [Network, 'Stronger Networks'],
];

const STEPS: Array<[LucideIcon, string, string]> = [
  [FileText, 'Fill in the form', 'Add any children coming with you. You get a registration number at once.'],
  [QrCode, 'Entry pass', 'Your pass with a QR code is ready as soon as you submit.'],
  [Download, 'Download or share', 'Keep the pass on your phone or print it for the entrance.'],
];

const SOCIAL_ICONS: Record<string, ReactNode> = {
  Facebook: <path d="M14.5 7.5h-1.6c-1.1 0-1.9.8-1.9 1.9V21M8.5 12.5h6" />,
  Instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.8" cy="7.2" r="0.6" fill="currentColor" />
    </>
  ),
  YouTube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3.5" />
      <path d="M10.5 9.6v4.8l4-2.4z" fill="currentColor" />
    </>
  ),
};

export default function Landing() {
  const [params] = useSearchParams();
  const state = useSite(params.get('preview') === '1');
  const heroCta = useRef<HTMLDivElement>(null);
  const passedHero = usePassed(heroCta, Boolean(state));
  useReveal(Boolean(state));

  useEffect(() => {
    if (state) document.title = plain(state.site.page.title) || 'Conference';
  }, [state]);

  if (!state) return <LoadingPage />;

  const { site } = state;
  const pv = state.source === 'preview';
  const p = site.page;
  const open = site.registrationOpen;
  // In preview, switched-off sections are still shown, outlined.
  const visible = (k: SectionKey) => p.show[k] || pv;
  const hiddenTag = (k: SectionKey) => (pv && !p.show[k] ? 'Hidden' : undefined);
  const pinned = site.announcements.find((a) => a.pinned && (a.status ?? 'published') !== 'draft');
  const words = themeWords(p.themeTitle);
  const themeLine = plain(p.themeTitle) || p.themeShort;
  const showTheme = visible('theme') && Boolean(p.themeTitle);
  const showAbout = visible('about') && Boolean(p.aboutBody || p.aboutImage || pv);
  const showVenue = visible('venue') || visible('contact');

  const nav: Array<[string, string]> = [['s-home', 'Home']];
  if (showTheme) nav.push(['s-theme', 'Theme']);
  if (showAbout) nav.push(['s-about', 'About']);
  if (visible('programme')) nav.push(['s-programme', 'Programme']);
  if (visible('speakers') && site.speakers.length) nav.push(['s-speakers', 'Speakers']);
  nav.push(['s-reg', 'Registration']);
  if (showVenue) nav.push(['s-contact', 'Venue']);
  if (visible('faq') && site.faqs.length) nav.push(['s-faq', 'FAQ']);

  const date = p.dateText ? splitDate(p.dateText) : null;
  const place = p.location || p.venue;
  const placeSub = p.location ? p.venue || 'Kerala, India' : '';

  const contacts = [
    ['Phone', p.phone, p.phone ? `tel:${p.phone.replace(/[^\d+]/g, '')}` : null],
    ['WhatsApp', p.whatsapp, p.whatsapp ? `https://wa.me/${p.whatsapp.replace(/\D/g, '')}` : null],
    ['Email', p.email, p.email ? `mailto:${p.email}` : null],
    ['Facebook', p.facebook && 'Facebook', safeHref(p.facebook)],
    ['Instagram', p.instagram && 'Instagram', safeHref(p.instagram)],
    ['YouTube', p.youtube && 'YouTube', safeHref(p.youtube)],
  ].filter((c): c is [string, string, string] => Boolean(c[1] && c[2]));
  const socials = contacts.filter(([label]) => label in SOCIAL_ICONS);
  const map = safeHref(p.mapUrl);

  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {pv && (
        <div className="pvbar" role="status">
          Preview: drafts, unpublished changes and hidden sections are outlined. Visitors do not see them. <a href="/admin/website/overview">Back to the editor</a>
        </div>
      )}
      {state.previewError && <div className="pvbar">{state.previewError} Showing the published website.</div>}

      {pinned && visible('updates') && (
        <div className={`topbar ${draftCls(pinned.status) ?? ''}`}>
          <div className="wrap">
            <b>{pinned.title}</b>
            <AnnouncementLink text={pinned.linkText} url={pinned.linkUrl} open={open} />
          </div>
        </div>
      )}

      <SiteHeader
        nav={nav}
        actions={
          open && (
            <Link to="/register" className="btn btn-reg hdr-reg">
              Register now <span className="arr" aria-hidden="true">→</span>
            </Link>
          )
        }
        menuAction={open && <RegisterButton open large />}
      />

      <main id="main">
        <section className="hero" id="s-home" aria-labelledby="hero-title">
          <Art left="hero-left" lazy={false} />
          <div className="wrap hero-grid">
            <img className="art art-line" src="/brand/bg/women-line.webp" width={1200} height={1152} alt="" aria-hidden="true" decoding="async" />
            <div className="hero-copy enter">
              {p.presenter && <p className="eyebrow">{p.presenter}</p>}
              <h1 id="hero-title">
                <Rich text={p.title} />
              </h1>
              {visible('theme') && themeLine && (
                <p className="hero-theme">
                  <span className="t">{themeLine}</span>
                  {p.themeSubtitle && <span className="s">{p.themeSubtitle}</span>}
                </p>
              )}
              {p.intro && <p className="lede">{p.intro}</p>}
              {(date || place) && (
                <dl className="facts">
                  {date && (
                    <div>
                      <dt className="sr-only">Date</dt>
                      <dd>
                        <span className="fic" aria-hidden="true">
                          <CalendarDays strokeWidth={1.6} />
                        </span>
                        <span>
                          <b>{date.big}</b>
                          {date.rest}
                        </span>
                      </dd>
                    </div>
                  )}
                  {place && (
                    <div>
                      <dt className="sr-only">Location</dt>
                      <dd>
                        <span className="fic" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M12 22s-7.5-6.4-7.5-12.2a7.5 7.5 0 0115 0C19.5 15.6 12 22 12 22z" fill="currentColor" />
                            <circle cx="12" cy="9.8" r="2.7" fill="#f6e4e1" />
                          </svg>
                        </span>
                        <span>
                          <b>{place}</b>
                          {placeSub}
                        </span>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <div className="hero-cta" ref={heroCta}>
                <RegisterButton open={open} large />
                {showTheme && (
                  <a className="explore" href="#s-theme">
                    <span className="explore-ic" aria-hidden="true">
                      <Play fill="currentColor" strokeWidth={1.5} />
                    </span>
                    Explore the theme
                  </a>
                )}
              </div>
            </div>
            <PosterSlider posters={POSTERS} />
          </div>
        </section>

        {visible('updates') && site.announcements.length > 0 && (
          <Section id="s-updates" label="Announcements" hidden={!p.show.updates} tag={hiddenTag('updates')}>
            <h2>
              <Rich text={p.updatesHeading || 'Latest updates'} />
            </h2>
            <div className="upd">
              {site.announcements.map((a) => (
                <article key={a.id} className={draftCls(a.status)}>
                  <h3>
                    {a.title}
                    <DraftTag status={a.status} />
                  </h3>
                  {a.body && <p>{a.body}</p>}
                  <AnnouncementLink text={a.linkText} url={a.linkUrl} open={open} className="lnk" />
                </article>
              ))}
            </div>
          </Section>
        )}

        {showTheme && (
          <section className={`band band-theme rv-art${!p.show.theme ? ' is-draft' : ''}`} id="s-theme" aria-labelledby="s-theme-label">
            <Art left="theme-left" right="theme-right" />
            <div className="wrap band-in">
              <p className="kicker" id="s-theme-label">
                The theme
                <DraftTag label={hiddenTag('theme')} />
              </p>
              {words ? (
                <ol className="words rv-kids" aria-label={themeLine}>
                  {words.map((w) => (
                    <li key={w}>
                      <LeafMark />
                      <span className="w">{w}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="quote rv">
                  <Rich text={p.themeTitle} />
                </p>
              )}
              {p.themeSubtitle && <p className="quote-sub rv">{p.themeSubtitle}</p>}
              {p.themeBody && (
                <div className="body rv">
                  <Paras text={p.themeBody} />
                </div>
              )}
            </div>
          </section>
        )}

        {showAbout && (
          <section className={`band band-wine rv-art${!p.show.about || !p.aboutBody ? ' is-draft' : ''}`} id="s-about" aria-labelledby="s-about-title">
            <Art left="about-left" right="about-right" />
            <div className="wrap about-grid">
              <div className="rv">
                <p className="kicker kicker-2">
                  <span>About</span>
                  <span>the conference</span>
                  <DraftTag label={hiddenTag('about') ?? (pv && !p.aboutBody ? 'Empty' : undefined)} />
                </p>
                <h2 id="s-about-title">
                  <Rich text={p.aboutHeading || 'About the conference'} />
                </h2>
              </div>
              <div>
                {p.aboutBody && (
                  <div className="body about-body rv">
                    <Paras text={p.aboutBody} />
                  </div>
                )}
                {p.aboutImage && (
                  <figure className="about-img rv">
                    <img src={p.aboutImage.url} alt={p.aboutImage.alt} width={p.aboutImage.width} height={p.aboutImage.height} loading="lazy" />
                    {p.aboutImage.caption && <figcaption>{p.aboutImage.caption}</figcaption>}
                  </figure>
                )}
                <ul className="pillars rv-kids">
                  {PILLARS.map(([Icon, label]) => (
                    <li key={label}>
                      <span className="ic" aria-hidden="true">
                        <Icon strokeWidth={1.5} />
                      </span>
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {visible('programme') && (
          <Section id="s-programme" label="Programme" hidden={!p.show.programme} tag={hiddenTag('programme')} art>
            {site.programme.length ? (
              <>
                <h2>
                  <Rich text={p.programmeHeading || 'Programme'} />
                </h2>
                {p.programmeIntro && (
                  <div className="body">
                    <Paras text={p.programmeIntro} />
                  </div>
                )}
                <ol className="prog">
                  {site.programme.map((item) => {
                    const when = timeRange(item.start, item.end);
                    const meta = [item.stage, ...item.speakers].filter(Boolean).join(' · ');
                    return (
                      <li key={item.id} className={[item.type === 'break' ? 'brk' : '', draftCls(item.status) ?? ''].join(' ').trim() || undefined}>
                        {when ? <span className="t">{when}</span> : <span className="t tbc">Time to be confirmed</span>}
                        <div>
                          <h3>
                            {item.title}
                            <DraftTag status={item.status} />
                          </h3>
                          {meta && <p className="meta">{meta}</p>}
                          {item.description && <p className="d">{item.description}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <div className="soon">
                <span className="soon-ic" aria-hidden="true">
                  <CalendarDays strokeWidth={1.5} />
                </span>
                <div>
                  <p className="soon-t">Programme will be announced soon.</p>
                  <p className="soon-s">{p.programmeIntro || 'Details about sessions, speakers and schedule will be updated here.'}</p>
                </div>
                {socials[0] && (
                  <a className="btn gold" href={socials[0][2]} target="_blank" rel="noopener noreferrer">
                    Stay updated <span className="arr" aria-hidden="true">→</span>
                  </a>
                )}
              </div>
            )}
          </Section>
        )}

        {visible('speakers') && site.speakers.length > 0 && (
          <Section id="s-speakers" label="Speakers" hidden={!p.show.speakers} tag={hiddenTag('speakers')}>
            <h2>
              <Rich text={p.speakersHeading || 'Speakers'} />
            </h2>
            <div className="spk">
              {site.speakers.map((s) => (
                <article key={s.id} className={draftCls(s.status)}>
                  <div className="ph">
                    {s.photo ? (
                      <img src={s.photo.url} alt={s.photo.alt || s.name} loading="lazy" />
                    ) : (
                      <div className="ini" aria-hidden="true">
                        {initialsOf(s.name)}
                      </div>
                    )}
                  </div>
                  <h3>
                    {s.name}
                    <DraftTag status={s.status} />
                  </h3>
                  {s.role && <p className="role">{s.role}</p>}
                  {s.bio && (
                    <details>
                      <summary>Biography</summary>
                      <Paras text={s.bio} />
                    </details>
                  )}
                </article>
              ))}
            </div>
          </Section>
        )}

        {visible('gallery') && site.gallery.length > 0 && (
          <Section id="s-gallery" label="Gallery" hidden={!p.show.gallery} tag={hiddenTag('gallery')}>
            <h2>
              <Rich text={p.galleryHeading || 'Gallery'} />
            </h2>
            <div className="gal">
              {site.gallery.map((g) => (
                <figure key={g.id} className={draftCls(g.status)}>
                  <img src={g.image.url} alt={g.image.alt} width={g.image.width} height={g.image.height} loading="lazy" />
                  {(g.caption || (g.status && g.status !== 'published')) && (
                    <figcaption>
                      {g.caption}
                      <DraftTag status={g.status} />
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </Section>
        )}

        <section className="band band-wine band-reg rv-art" id="s-reg" aria-labelledby="s-reg-title">
          <Art left="reg-left" right="close-right" />
          <div className="wrap reg-in">
            <p className="kicker">Registration</p>
            <h2 id="s-reg-title" className="rv">
              <Rich text={p.regHeading || 'Register once. Get your entry pass instantly.'} />
            </h2>
            <ol className="rsteps rv-kids">
              {STEPS.map(([Icon, title, text], i) => (
                <li key={title}>
                  <span className="num" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="ic" aria-hidden="true">
                    <Icon strokeWidth={1.6} />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
            {p.regNote && <p className="reg-note rv">{p.regNote}</p>}
            <div className="reg-cta rv">
              <RegisterButton open={open} large />
              {open && (
                <p className="reg-sub">
                  Quick and easy registration <span aria-hidden="true">·</span> Get your entry pass instantly
                </p>
              )}
            </div>
          </div>
        </section>

        {showVenue && (
          <Section id="s-contact" label={visible('contact') ? 'Venue & contact' : 'Venue'} hidden={!p.show.venue && !p.show.contact} art>
            {visible('venue') && (
              <div className={`vrow${!p.show.venue ? ' is-draft' : ''}`}>
                <span className="vic" aria-hidden="true">
                  <MapPin strokeWidth={1.6} />
                </span>
                <div>
                  <h3>
                    {p.venue || p.location || 'Venue'}
                    <DraftTag label={hiddenTag('venue')} />
                  </h3>
                  <p className="addr">{p.venueAddress || `${p.venue && p.location ? `${p.location}. ` : ''}Full venue details will be announced.`}</p>
                </div>
                {map && (
                  <a className="btn line" href={map} target="_blank" rel="noopener noreferrer">
                    View on map <span className="arr" aria-hidden="true">→</span>
                  </a>
                )}
              </div>
            )}
            {visible('contact') && (
              <div className={`vc-card${!p.show.contact ? ' is-draft' : ''}`}>
                <h3>
                  Contact
                  <DraftTag label={hiddenTag('contact')} />
                </h3>
                {contacts.length ? (
                  <ul className="clist">
                    {contacts.map(([label, text, href]) => (
                      <li key={label}>
                        <span>{label}</span>
                        <a href={href} {...(/^https?:/.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                          {text}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="addr">Contact details will be published soon.</p>
                )}
              </div>
            )}
          </Section>
        )}

        {visible('faq') && site.faqs.length > 0 && (
          <Section id="s-faq" label="FAQ" hidden={!p.show.faq} tag={hiddenTag('faq')}>
            <h2>
              <Rich text={p.faqHeading || 'Questions'} />
            </h2>
            <div className="faq">
              {site.faqs.map((f) => (
                <details key={f.id} className={draftCls(f.status)}>
                  <summary>
                    <span>
                      {f.question}
                      <DraftTag status={f.status} />
                    </span>
                  </summary>
                  <p className="a">{f.answer}</p>
                </details>
              ))}
            </div>
          </Section>
        )}

        {p.closingText && (
          <section className="close rv-art" aria-labelledby="close-title">
            <Art right="close-right" />
            <img className="art art-group" src="/brand/bg/women-group.webp" width={900} height={804} alt="" aria-hidden="true" loading="lazy" decoding="async" />
            <div className="wrap rv-kids">
              <p className="kicker">{plain(p.title)}</p>
              <h2 id="close-title">
                {/* "15 November 2026, *Ernakulam*": the emphasis goes on its own line, so the comma goes. */}
                <Rich text={p.closingText.replace(/,\s*\*/, ' *')} />
              </h2>
              <div>
                <RegisterButton open={open} large />
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="ftr">
        <div className="wrap ftr-in rv-kids">
          <img src="/brand/bbb-logo-w.webp" width={204} height={220} alt="Being, Becoming, Belonging" loading="lazy" className="f-bbb" />
          <img src="/brand/icw-logo.webp" width={560} height={242} alt="International Conference on Women" loading="lazy" className="f-icw" />
          <img src="/brand/gio-logo-white.webp" width={299} height={220} alt="GIO Keralam" loading="lazy" className="f-gio" />
          {socials.length > 0 && (
            <ul className="social">
              {socials.map(([label, , href]) => (
                <li key={label}>
                  <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {SOCIAL_ICONS[label]}
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="wrap">
          <div className="ftr-base">
            <span>{p.footerText}</span>
            <span>
              Powered by:{' '}
              <a href="https://d4dx.co/" target="_blank" rel="noopener noreferrer" className="credit">
                D4DX Innovations LLP
              </a>
            </span>
          </div>
        </div>
      </footer>

      {open && (
        <div className={`sticky-cta${passedHero ? ' show' : ''}`} aria-hidden={!passedHero || undefined}>
          <Link to="/register" className="btn btn-reg" tabIndex={passedHero ? undefined : -1}>
            Register now <span className="arr" aria-hidden="true">→</span>
          </Link>
        </div>
      )}
      <BackToTop raised={open} />
    </div>
  );
}

function AnnouncementLink({ text, url, open, className }: { text: string; url: string; open: boolean; className?: string }) {
  const href = safeHref(url);
  if (!text || !href) return null;
  if (href === '/register') {
    return open ? (
      <Link to="/register" className={className}>
        {text}
      </Link>
    ) : null;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}
