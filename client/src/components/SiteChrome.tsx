// Header and social links shared by the public website and the
// registration page (styles in site.css).
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUp, Menu, X } from 'lucide-react';

/** The nav entry whose section crosses the middle of the viewport. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join('|');
  useEffect(() => {
    if (!key || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)), {
      rootMargin: '-45% 0px -54% 0px',
    });
    key.split('|').forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [key]);
  return active;
}

const SOCIAL_ICONS: Record<string, ReactNode> = {
  Facebook: (
    <>
      <circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.9 21.3v-7.4h2.2l.33-2.6H12.9V9.8c0-.75.2-1.26 1.28-1.26h1.36V6.22a18 18 0 0 0-1.98-.1c-1.96 0-3.3 1.2-3.3 3.4v1.8H8.06v2.6h2.2v7.4z" fill="currentColor" />
    </>
  ),
  Instagram: (
    <>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.1" cy="6.9" r="1.1" fill="currentColor" />
    </>
  ),
  YouTube: (
    <path
      fillRule="evenodd"
      fill="currentColor"
      d="M21.58 7.19a2.75 2.75 0 0 0-1.94-1.95C17.93 4.8 12 4.8 12 4.8s-5.93 0-7.64.44a2.75 2.75 0 0 0-1.94 1.95A28.6 28.6 0 0 0 2 12a28.6 28.6 0 0 0 .42 4.81 2.75 2.75 0 0 0 1.94 1.95c1.71.44 7.64.44 7.64.44s5.93 0 7.64-.44a2.75 2.75 0 0 0 1.94-1.95A28.6 28.6 0 0 0 22 12a28.6 28.6 0 0 0-.42-4.81zM10 15.1V8.9l5.2 3.1z"
    />
  ),
};

/** Facebook, Instagram and YouTube icons linking to GIO Keralam's accounts. */
export function SocialLinks({ links, className = '' }: { links: Array<[string, string]>; className?: string }) {
  return (
    <ul className={`social ${className}`}>
      {links.map(([label, href]) => (
        <li key={label}>
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`GIO Keralam on ${label}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {SOCIAL_ICONS[label]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * From 960px: a white band with the three event logos, then a sticky bar with
 * the section links and a call to action. Below that the bar alone is sticky,
 * with the conference logo and a menu that closes on Escape, on a link and on
 * resize.
 */
export function SiteHeader({
  nav = [],
  actions,
  menuAction,
  socials,
}: {
  nav?: Array<[string, string]>;
  actions?: ReactNode;
  menuAction?: ReactNode;
  socials?: Array<[string, string]>;
}) {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const band = useRef<HTMLElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();
  const active = useActiveSection(nav.map(([id]) => id));
  const toTop = () => pathname === '/' && window.scrollTo({ top: 0, behavior: 'smooth' });

  useEffect(() => {
    // The band is hidden on small screens, so its height is 0 there.
    const on = () => setStuck(window.scrollY > (band.current?.offsetHeight ?? 0));
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => window.innerWidth >= 960 && setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <>
      <header className="band-hdr" ref={band}>
        <div className="wrap band-hdr-in">
          <img className="lg lg-bbb" src="/brand/bbb-logo-dark.webp" width={204} height={220} alt="Being, Becoming, Belonging: Reimagining the Self, Space and Society" />
          <Link to="/" className="lg lg-icw" onClick={toTop}>
            <img src="/brand/icw-logo-dark.webp" width={1120} height={485} alt="International Conference on Women" />
          </Link>
          <div className="lg lg-gio">
            <img src="/brand/gio-mark-maroon.webp" width={450} height={275} alt="GIO Keralam" />
            {socials && <SocialLinks links={socials} />}
          </div>
        </div>
      </header>

      <div className={`hdr${stuck || open ? ' is-scrolled' : ''}`}>
        <div className="wrap hdr-in">
          <Link to="/" className="hdr-logo" onClick={toTop}>
            <img src="/brand/icw-logo-dark.webp" width={1120} height={485} alt="International Conference on Women" />
          </Link>
          {nav.length > 0 && (
            <>
              <nav className="nav" aria-label="Sections">
                {nav.map(([id, label]) => (
                  <a key={id} href={`#${id}`} className={active === id ? 'on' : undefined} aria-current={active === id ? 'location' : undefined}>
                    {label}
                  </a>
                ))}
              </nav>
              <button type="button" className="menu-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
                {open ? <X aria-hidden="true" strokeWidth={1.8} /> : <Menu aria-hidden="true" strokeWidth={1.8} />}
                <span className="sr-only">{open ? 'Close menu' : 'Menu'}</span>
              </button>
            </>
          )}
          <div className="hdr-actions">{actions}</div>
        </div>
        {open && (
          <div className="menu" id={menuId}>
            <div className="wrap">
              <nav aria-label="Sections">
                <ul>
                  {nav.map(([id, label]) => (
                    <li key={id}>
                      <a href={`#${id}`} onClick={() => setOpen(false)}>
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              {menuAction}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Round button at the bottom right that returns to the top, shown once the
 * page has scrolled most of a screen.
 */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 0.8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <button
      type="button"
      className={`to-top${show ? ' show' : ''}`}
      aria-label="Back to top"
      aria-hidden={!show || undefined}
      tabIndex={show ? undefined : -1}
      onClick={(e) => {
        // The page's scroll-behavior makes this smooth unless reduced motion is on.
        window.scrollTo({ top: 0 });
        e.currentTarget.blur();
      }}
    >
      <ArrowUp aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
}
