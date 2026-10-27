// Public conference website. Content comes from the published website
// settings (GET /api/public/site). Admins can open /?preview=1 to see drafts
// and hidden sections, outlined. Optional sections stay hidden until they
// have published content.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../site.css';
import { api, ApiError } from '../lib/api';
import type { ItemStatus, PublicSite, SectionKey } from '../lib/types';
import { FALLBACK_SITE, Paras, Rich, initialsOf, plain, safeHref, timeRange } from '../lib/site';
import { Flourish, Leaf, SiteHeader } from '../components/SiteChrome';

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
 * Fades sections in as they scroll into view. Only elements still below the
 * fold are hidden first, and nothing is hidden with reduced motion or without
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
    document.querySelectorAll<HTMLElement>('.site .rv').forEach((el) => {
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

function Section({
  id,
  label,
  hidden,
  tag,
  tone,
  className,
  children,
}: {
  id: string;
  label: string;
  hidden?: boolean;
  tag?: string;
  tone?: 'cream' | 'wine';
  className?: string;
  children: ReactNode;
}) {
  const cls = ['sec', tone && `tone-${tone}`, hidden && 'is-draft', className].filter(Boolean).join(' ');
  return (
    <section className={cls} id={id} aria-labelledby={`${id}-label`}>
      {tone === 'wine' && <Flourish />}
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
    <Link to="/register" className={`btn ${large ? 'lg' : ''} ${className}`}>
      Register now <span className="arr" aria-hidden="true">→</span>
    </Link>
  );
}

function LoadingPage() {
  return (
    <div className="site" aria-busy="true">
      <header className="hdr">
        <div className="wrap hdr-in">
          <span className="sk" style={{ width: 120, height: 40 }} />
        </div>
      </header>
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

/** "Being, Becoming, Belonging" becomes a stacked list; anything else stays one line. */
function themeWords(title: string) {
  const parts = plain(title)
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  return parts.length >= 2 && parts.length <= 4 && parts.every((w) => w.split(/\s+/).length <= 2) ? parts : null;
}

const ROMAN = ['i', 'ii', 'iii', 'iv'];

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

  const showAbout = visible('about') && Boolean(p.aboutBody || p.aboutImage || pv);
  const nav: Array<[string, string]> = [];
  if (showAbout) nav.push(['s-about', 'About']);
  if (visible('theme') && p.themeTitle) nav.push(['s-theme', 'Theme']);
  if (visible('programme')) nav.push(['s-programme', 'Programme']);
  if (visible('speakers') && site.speakers.length) nav.push(['s-speakers', 'Speakers']);
  nav.push(['s-reg', 'Registration']);
  if (visible('faq') && site.faqs.length) nav.push(['s-faq', 'FAQ']);
  if (visible('venue') || visible('contact')) nav.push(['s-contact', 'Venue']);

  const facts = [
    ['Date', p.dateText],
    ['Location', p.location],
    ['Venue', p.venue],
  ].filter(([, v]) => v);

  const contacts = [
    ['Phone', p.phone, p.phone ? `tel:${p.phone.replace(/[^\d+]/g, '')}` : null],
    ['WhatsApp', p.whatsapp, p.whatsapp ? `https://wa.me/${p.whatsapp.replace(/\D/g, '')}` : null],
    ['Email', p.email, p.email ? `mailto:${p.email}` : null],
    ['Facebook', p.facebook && 'Facebook', safeHref(p.facebook)],
    ['Instagram', p.instagram && 'Instagram', safeHref(p.instagram)],
    ['YouTube', p.youtube && 'YouTube', safeHref(p.youtube)],
  ].filter((c): c is [string, string, string] => Boolean(c[1] && c[2]));
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
        logo={p.logo}
        nav={nav}
        actions={
          open && (
            <Link to="/register" className="btn hdr-reg">
              Register now
            </Link>
          )
        }
        menuAction={open && <RegisterButton open large />}
      />

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <Flourish />
          <div className={`wrap hero-grid${p.poster ? '' : ' solo'}`}>
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
              {facts.length > 0 && (
                <dl className="facts">
                  {facts.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="hero-cta" ref={heroCta}>
                <RegisterButton open={open} large />
                {visible('theme') && p.themeTitle && (
                  <a className="tlink" href="#s-theme">
                    Explore the theme
                  </a>
                )}
              </div>
            </div>
            {p.poster && (
              <figure className="poster">
                <div className="poster-print">
                  <img src={p.poster.url} alt={p.poster.alt} width={p.poster.width} height={p.poster.height} decoding="async" />
                </div>
                {(p.posterCaption || p.posterTag) && (
                  <figcaption>
                    <span>{p.posterCaption}</span>
                    <span>{p.posterTag}</span>
                  </figcaption>
                )}
              </figure>
            )}
          </div>
        </section>

        {visible('updates') && site.announcements.length > 0 && (
          <Section id="s-updates" label="Announcements" hidden={!p.show.updates} tag={hiddenTag('updates')} className="after-hero">
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

        {showAbout && (
          <Section
            id="s-about"
            label="About"
            hidden={!p.show.about || !p.aboutBody}
            tag={hiddenTag('about') ?? (pv && !p.aboutBody ? 'Empty' : undefined)}
            className="after-hero"
          >
            <h2>
              <Rich text={p.aboutHeading || 'About the conference'} />
            </h2>
            {p.aboutBody && (
              <div className="body">
                <Paras text={p.aboutBody} />
              </div>
            )}
            {p.aboutImage && (
              <figure className="about-img">
                <img src={p.aboutImage.url} alt={p.aboutImage.alt} width={p.aboutImage.width} height={p.aboutImage.height} loading="lazy" />
                {p.aboutImage.caption && <figcaption>{p.aboutImage.caption}</figcaption>}
              </figure>
            )}
          </Section>
        )}

        {visible('theme') && p.themeTitle && (
          <Section id="s-theme" label="The theme" hidden={!p.show.theme} tag={hiddenTag('theme')} tone="wine">
            {words ? (
              <ol className="words" aria-label={themeLine}>
                {words.map((w, i) => (
                  <li key={w}>
                    <span className="n" aria-hidden="true">
                      {ROMAN[i]}
                    </span>
                    <span className="w">{w}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="quote">
                <Rich text={p.themeTitle} />
              </p>
            )}
            {p.themeSubtitle && <p className="quote-sub">{p.themeSubtitle}</p>}
            {p.themeBody && (
              <div className="body">
                <Paras text={p.themeBody} />
              </div>
            )}
          </Section>
        )}

        {visible('programme') && (
          <Section id="s-programme" label="Programme" hidden={!p.show.programme} tag={hiddenTag('programme')}>
            <h2>
              <Rich text={p.programmeHeading || 'Programme'} />
            </h2>
            {p.programmeIntro && (
              <div className="body">
                <Paras text={p.programmeIntro} />
              </div>
            )}
            {site.programme.length ? (
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
            ) : (
              <div className="empty-note">
                <Leaf />
                <p>Programme will be announced soon.</p>
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

        <Section id="s-reg" label="Registration" tone="cream">
          <h2>
            <Rich text={p.regHeading || 'Register once. Your entry pass comes on WhatsApp.'} />
          </h2>
          <ol className="steps">
            <li>
              <span className="n">i.</span>
              <h3>Fill in the form</h3>
              <p>You receive a registration number at once.</p>
            </li>
            <li>
              <span className="n">ii.</span>
              <h3>Confirmation</h3>
              <p>GIO Keralam reviews and confirms your registration.</p>
            </li>
            <li>
              <span className="n">iii.</span>
              <h3>Entry pass</h3>
              <p>A pass with a QR code is sent on WhatsApp for the entrance.</p>
            </li>
          </ol>
          {p.regNote && <p className="body">{p.regNote}</p>}
          <div className="hero-cta">
            <RegisterButton open={open} large />
          </div>
        </Section>

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

        {(visible('venue') || visible('contact')) && (
          <Section id="s-contact" label="Venue & contact" hidden={!p.show.venue && !p.show.contact}>
            <div className="vc">
              {visible('venue') && (
                <div className={`vc-card${!p.show.venue ? ' is-draft' : ''}`}>
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" />
                      <circle cx="12" cy="9.5" r="2.5" />
                    </svg>
                  </span>
                  <h3>
                    {p.venue || p.location || 'Venue'}
                    <DraftTag label={hiddenTag('venue')} />
                  </h3>
                  <p className="addr">{p.venueAddress || `${p.venue && p.location ? `${p.location}. ` : ''}Full venue details will be announced.`}</p>
                  {p.dateText && (
                    <p className="when">
                      <span>Date</span>
                      <b>{p.dateText}</b>
                    </p>
                  )}
                  {map && (
                    <a className="maplink" href={map} target="_blank" rel="noopener noreferrer">
                      Open in Maps
                    </a>
                  )}
                </div>
              )}
              {visible('contact') && (
                <div className={`vc-card${!p.show.contact ? ' is-draft' : ''}`}>
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6.5h16v11H4z" />
                      <path d="M4.5 7l7.5 6 7.5-6" />
                    </svg>
                  </span>
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
            </div>
          </Section>
        )}

        {p.closingText && (
          <section className="close" aria-labelledby="close-title">
            <Flourish />
            <div className="wrap rv">
              <p className="eyebrow">{plain(p.title)}</p>
              <h2 id="close-title">
                <Rich text={p.closingText} />
              </h2>
              <RegisterButton open={open} large />
            </div>
          </section>
        )}
      </main>

      <footer className="ftr">
        <div className="wrap ftr-in">
          {p.logo && <img src={p.logo.url} alt={p.logo.alt} width={p.logo.width} height={p.logo.height} loading="lazy" />}
          <p>{p.footerText}</p>
          {nav.length > 0 && (
            <nav aria-label="Footer">
              {nav.map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                </a>
              ))}
              {open && <Link to="/register">Register</Link>}
            </nav>
          )}
        </div>
        <div className="wrap">
          <div className="ftr-base">
            <span>{[p.dateText, p.location].filter(Boolean).join(' · ')}</span>
            <a href="#main">Back to top ↑</a>
          </div>
        </div>
      </footer>

      {open && (
        <div className={`sticky-cta${passedHero ? ' show' : ''}`} aria-hidden={!passedHero || undefined}>
          <Link to="/register" className="btn" tabIndex={passedHero ? undefined : -1}>
            Register now <span className="arr" aria-hidden="true">→</span>
          </Link>
        </div>
      )}
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
