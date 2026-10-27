// Public conference website. Content comes from the published website
// settings (GET /api/public/site). Admins can open /?preview=1 to see drafts
// and hidden sections, outlined. Optional sections stay hidden until they
// have published content.
import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, FileText, MapPin, MessageSquareText, UserRound } from 'lucide-react';
import '../site.css';
import { api, ApiError } from '../lib/api';
import type { ItemStatus, PublicSite, SectionKey } from '../lib/types';
import { FALLBACK_SITE, Paras, Rich, initialsOf, plain, safeHref, socialLinks, timeRange } from '../lib/site';
import { BackToTop, SiteHeader, SocialLinks } from '../components/SiteChrome';

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
 * Reveals content as it scrolls into view: `.rv` fades up and `.rv-kids`
 * staggers its children. Only elements still below the fold are hidden
 * first, and nothing is hidden with reduced motion or without
 * IntersectionObserver, so content is never held back.
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
    document.querySelectorAll<HTMLElement>('.site .rv, .site .rv-kids').forEach((el) => {
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add('rv-on');
        io.observe(el);
      }
    });
    return () => io.disconnect();
  }, [ready]);
}

const DraftTag = ({ status, label }: { status?: ItemStatus; label?: string }) =>
  label || (status && status !== 'published') ? <span className="draft-tag">{label ?? (status === 'changed' ? 'Unpublished changes' : 'Draft')}</span> : null;

const draftCls = (status?: ItemStatus) => (status && status !== 'published' ? 'is-draft' : undefined);

/** A gold leaf sprig; each placement (`at`) is set in site.css. */
const Leaf = ({ at }: { at: string }) => <img className={`leaf ${at}`} src="/brand/bg/leaves-gold.svg" width={320} height={520} alt="" aria-hidden="true" decoding="async" />;

/** White band with a centred heading over a short red rule. */
function Section({ id, title, hidden, tag, leaves, children }: { id: string; title: ReactNode; hidden?: boolean; tag?: string; leaves?: boolean; children: ReactNode }) {
  return (
    <section className={`sec${hidden ? ' is-draft' : ''}`} id={id} aria-labelledby={`${id}-title`}>
      {leaves && (
        <>
          <Leaf at="lv-l" />
          <Leaf at="lv-r" />
        </>
      )}
      <div className="wrap sec-in">
        <h2 className="sec-title rv" id={`${id}-title`}>
          {title}
          {tag && <span className="draft-tag">{tag}</span>}
        </h2>
        {children}
      </div>
    </section>
  );
}

function RegisterButton({ open, className = '' }: { open: boolean; className?: string }) {
  if (!open) {
    return (
      <span className={`btn is-closed ${className}`} aria-disabled="true">
        Registrations closed
      </span>
    );
  }
  return (
    <Link to="/register" className={`btn btn-reg ${className}`}>
      Register Now <ArrowRight className="arr" aria-hidden="true" strokeWidth={2} />
    </Link>
  );
}

function LoadingPage() {
  return (
    <div className="site" aria-busy="true">
      <div className="band-hdr">
        <div className="wrap band-hdr-in" style={{ minHeight: 140 }} />
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

/** "15 November 2026" -> "15" over "November 2026"; other formats stay whole. */
function splitDate(text: string) {
  const m = /^(\d{1,2}(?:\s*[–-]\s*\d{1,2})?)\s+(.+)$/.exec(text.trim());
  return m ? { big: m[1], rest: m[2] } : { big: text, rest: '' };
}

/**
 * The page title with its `*emphasis*` set like the conference logo: on its
 * own line, larger, in red, with the first "o" drawn as the leaf.
 */
function HeroTitle({ text }: { text: string }) {
  const parts = String(text || '').split('*');
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0 || i === parts.length - 1) return <Fragment key={i}>{part}</Fragment>;
        const o = part.indexOf('o');
        return (
          <em key={i}>
            {o < 0 ? (
              part
            ) : (
              <>
                <span className="sr-only">{part}</span>
                <span aria-hidden="true">
                  {part.slice(0, o)}
                  <img className="leaf-o" src="/brand/icw-o.webp" width={230} height={202} alt="" />
                  {part.slice(o + 1)}
                </span>
              </>
            )}
          </em>
        );
      })}
    </>
  );
}

/** Highlights running across a dark band. The first copy is read out; the repeats that keep it looping are hidden. */
function Ticker({ items }: { items: string[] }) {
  return (
    <div className="ticker" role="region" aria-label="Highlights">
      <div className="tk-track">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <ul key={n} className="tk-group" aria-hidden={n > 0 || undefined}>
            {items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

/** The official poster, with a larger copy for wide and high-density screens. */
const POSTER = {
  src: '/brand/poster-2.jpg',
  srcSet: '/brand/poster-2.jpg 720w, /brand/poster.jpg 1200w',
  alt: 'Conference poster: International Conference on Women, 15 November 2026, Ernakulam. Being, Becoming, Belonging: Reimagining the Self, Space and Society.',
};

// Until a brochure is supplied, "View Brochure" opens the full-size poster.
const BROCHURE_URL = '/brand/poster.jpg';

const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

const STATS: Array<{ icon: ReactNode; value?: string; label: string }> = [
  {
    icon: (
      <svg {...ico}>
        <circle cx="12" cy="7.2" r="2.6" />
        <circle cx="5.3" cy="8.6" r="2.1" />
        <circle cx="18.7" cy="8.6" r="2.1" />
        <path d="M7.6 19v-1.3a4.4 4.4 0 0 1 8.8 0V19M1.8 18.4v-.8a3.5 3.5 0 0 1 4.9-3.2M22.2 18.4v-.8a3.5 3.5 0 0 0-4.9-3.2" />
      </svg>
    ),
    value: '350+',
    label: 'Attendees',
  },
  { icon: <UserRound strokeWidth={1.6} aria-hidden="true" />, value: '15+', label: 'Guests' },
  { icon: <BookOpen strokeWidth={1.6} aria-hidden="true" />, label: 'Thoughtful Sessions' },
  { icon: <MessageSquareText strokeWidth={1.6} aria-hidden="true" />, label: 'Meaningful Dialogues' },
  {
    icon: (
      <svg {...ico}>
        <circle cx="12" cy="5.4" r="2.5" />
        <circle cx="5.6" cy="17.8" r="2.5" />
        <circle cx="18.4" cy="17.8" r="2.5" />
        <path d="M12 7.9v4.3l-4.6 3.8M12 12.2l4.6 3.8" />
      </svg>
    ),
    label: 'Stronger Networks',
  },
];

export default function Landing() {
  const [params] = useSearchParams();
  const state = useSite(params.get('preview') === '1');
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
  const themeLine = plain(p.themeTitle) || p.themeShort;
  const showTheme = visible('theme') && Boolean(themeLine);
  const showAbout = visible('about');
  const showContact = visible('contact');

  const nav: Array<[string, string]> = [['s-home', 'Home']];
  if (showTheme) nav.push(['s-theme', 'Theme']);
  if (showAbout) nav.push(['s-about', 'About']);
  if (visible('programme')) nav.push(['s-programme', 'Programme']);
  if (visible('speakers') && site.speakers.length) nav.push(['s-speakers', 'Speakers']);
  nav.push(['s-reg', 'Registration']);
  if (visible('venue')) nav.push(['s-venue', 'Venue']);
  if (visible('faq') && site.faqs.length) nav.push(['s-faq', 'FAQ']);
  // Without a contact section, Contact goes to the footer and its social links.
  nav.push(['s-contact', 'Contact']);

  const date = p.dateText ? splitDate(p.dateText) : null;
  const place = p.location || p.venue;
  const placeSub = p.location ? p.venue || 'Kerala, India' : '';

  const ticker = [
    pinned && visible('updates') ? pinned.title : '',
    p.dateText ? `${plain(p.title)} is happening on ${p.dateText}` : plain(p.title),
    open ? 'Registration Open' : 'Registration Closed',
    visible('theme') ? themeLine : '',
  ].filter(Boolean);

  const contacts = [
    ['Phone', p.phone, p.phone ? `tel:${p.phone.replace(/[^\d+]/g, '')}` : null],
    ['WhatsApp', p.whatsapp, p.whatsapp ? `https://wa.me/${p.whatsapp.replace(/\D/g, '')}` : null],
    ['Email', p.email, p.email ? `mailto:${p.email}` : null],
    ['Facebook', p.facebook && 'Facebook', safeHref(p.facebook)],
    ['Instagram', p.instagram && 'Instagram', safeHref(p.instagram)],
    ['YouTube', p.youtube && 'YouTube', safeHref(p.youtube)],
  ].filter((c): c is [string, string, string] => Boolean(c[1] && c[2]));
  const socials = socialLinks(p);
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

      <SiteHeader nav={nav} socials={socials} actions={open && <RegisterButton open className="hdr-reg" />} menuAction={open && <RegisterButton open />} />

      <main id="main">
        <section className="hero" id="s-home" aria-labelledby="hero-title">
          <Leaf at="lv-hero-l" />
          <Leaf at="lv-hero-r" />
          <div className="wrap hero-grid">
            <div className="hero-copy enter">
              {p.presenter && <p className="eyebrow">{p.presenter}</p>}
              <h1 id="hero-title">
                <HeroTitle text={p.title} />
              </h1>
              {showTheme && (
                <div className={`hero-theme${!p.show.theme ? ' is-draft' : ''}`} id="s-theme">
                  <img src="/brand/bbb-logo-dark.webp" width={204} height={220} alt={[themeLine, p.themeSubtitle].filter(Boolean).join(': ')} />
                  <DraftTag label={hiddenTag('theme')} />
                </div>
              )}
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
                          <MapPin strokeWidth={1.6} />
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
            </div>
            <figure className="poster">
              <img src={POSTER.src} srcSet={POSTER.srcSet} sizes="(min-width: 960px) 34vw, 100vw" alt={POSTER.alt} width={720} height={960} decoding="async" />
              {open && <RegisterButton open className="poster-reg" />}
            </figure>
          </div>
        </section>

        <Ticker items={ticker} />

        {showAbout && (
          <Section id="s-about" title={<Rich text={p.aboutHeading || 'About the conference'} />} hidden={!p.show.about} tag={hiddenTag('about')} leaves>
            <div className="body rv">
              <Paras text={p.aboutBody || FALLBACK_SITE.page.aboutBody} />
            </div>
            {p.aboutImage && (
              <figure className="about-img rv">
                <img src={p.aboutImage.url} alt={p.aboutImage.alt} width={p.aboutImage.width} height={p.aboutImage.height} loading="lazy" />
                {p.aboutImage.caption && <figcaption>{p.aboutImage.caption}</figcaption>}
              </figure>
            )}
            <ul className="stats rv-kids">
              {STATS.map(({ icon, value, label }) => (
                <li key={label}>
                  <span className="st-ic">{icon}</span>
                  <p className="st-t">
                    {value ? (
                      <>
                        <b className="v">{value}</b> <span>{label}</span>
                      </>
                    ) : (
                      label.split(' ').map((w, i) => (
                        <Fragment key={w}>
                          {i > 0 && ' '}
                          <b>{w}</b>
                        </Fragment>
                      ))
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <section className="cta-sec" id="s-reg" aria-labelledby="s-reg-title">
          <div className="wrap-w">
            <div className="cta rv">
              <Leaf at="lv-cta-l" />
              <Leaf at="lv-cta-r" />
              <div className="cta-copy">
                <h2 id="s-reg-title">
                  Witness <em>Herstory</em>. Live.
                </h2>
                <p>Be part of a global conversation that matters.</p>
              </div>
              <div className="cta-actions">
                <RegisterButton open={open} />
                <a className="btn line" href={BROCHURE_URL} target="_blank" rel="noopener noreferrer">
                  <FileText aria-hidden="true" strokeWidth={1.6} /> View Brochure
                </a>
              </div>
            </div>
          </div>
        </section>

        {visible('updates') && site.announcements.length > 0 && (
          <Section id="s-updates" title={<Rich text={p.updatesHeading || 'Latest updates'} />} hidden={!p.show.updates} tag={hiddenTag('updates')}>
            <div className="upd sec-body rv">
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

        {visible('programme') && (
          <Section id="s-programme" title={<Rich text={p.programmeHeading || 'Programme'} />} hidden={!p.show.programme} tag={hiddenTag('programme')} leaves>
            {site.programme.length ? (
              <div className="sec-body rv">
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
              </div>
            ) : (
              <div className="note rv">
                <span className="note-ic" aria-hidden="true">
                  <CalendarDays strokeWidth={1.6} />
                </span>
                <div>
                  <h3>Programme will be announced soon.</h3>
                  <p>{p.programmeIntro || 'Details about sessions, speakers and schedule will be updated here.'}</p>
                </div>
              </div>
            )}
          </Section>
        )}

        {visible('speakers') && site.speakers.length > 0 && (
          <Section id="s-speakers" title={<Rich text={p.speakersHeading || 'Speakers'} />} hidden={!p.show.speakers} tag={hiddenTag('speakers')}>
            <div className="spk sec-body rv">
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
          <Section id="s-gallery" title={<Rich text={p.galleryHeading || 'Gallery'} />} hidden={!p.show.gallery} tag={hiddenTag('gallery')}>
            <div className="gal sec-body rv">
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

        {visible('venue') && (
          <Section id="s-venue" title="Venue" hidden={!p.show.venue} tag={hiddenTag('venue')} leaves>
            <div className="note rv">
              <span className="note-ic" aria-hidden="true">
                <MapPin strokeWidth={1.6} />
              </span>
              <div>
                <h3>{p.venue || p.location || 'Venue'}</h3>
                <p>{p.venueAddress || `${p.venue && p.location ? `${p.location}. ` : ''}Full venue details will be announced.`}</p>
              </div>
              {map && (
                <a className="btn line" href={map} target="_blank" rel="noopener noreferrer">
                  View on map <ArrowRight className="arr" aria-hidden="true" strokeWidth={2} />
                </a>
              )}
            </div>
          </Section>
        )}

        {visible('faq') && site.faqs.length > 0 && (
          <Section id="s-faq" title={<Rich text={p.faqHeading || 'Questions'} />} hidden={!p.show.faq} tag={hiddenTag('faq')}>
            <div className="faq sec-body rv">
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

        {showContact && (
          <Section id="s-contact" title="Contact" hidden={!p.show.contact} tag={hiddenTag('contact')}>
            <div className="note note-list rv">
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
                <p>Contact details will be published soon.</p>
              )}
            </div>
          </Section>
        )}
      </main>

      <footer className="ftr" id={showContact ? undefined : 's-contact'}>
        <Leaf at="lv-ftr-l" />
        <Leaf at="lv-ftr-r" />
        <div className="wrap-w ftr-in">
          <img src="/brand/bbb-logo-w.webp" width={204} height={220} alt="Being, Becoming, Belonging" loading="lazy" className="f-bbb" />
          <img src="/brand/icw-logo-white.webp" width={560} height={243} alt="International Conference on Women" loading="lazy" className="f-icw" />
          <div className="f-gio">
            <img src="/brand/gio-mark-white.webp" width={299} height={183} alt="GIO Keralam" loading="lazy" />
            <SocialLinks links={socials} />
          </div>
        </div>
        <div className="wrap-w">
          <div className="ftr-base">
            <span>{p.footerText}</span>
            <span>
              Powered by{' '}
              <a href="https://d4dx.co/" target="_blank" rel="noopener noreferrer" className="credit">
                D4DX Innovations LLP
              </a>
            </span>
          </div>
        </div>
      </footer>

      <BackToTop />
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
