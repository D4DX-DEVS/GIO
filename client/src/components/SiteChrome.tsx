// Header and decorative pieces shared by the public website and the
// registration page (styles in site.css).
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';

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

/**
 * Wine band with the three event logos, then a sticky bar with the section
 * links and a call to action. Below 960px the links move into a menu that
 * closes on Escape, on a link and on resize.
 */
export function SiteHeader({ nav = [], actions, menuAction }: { nav?: Array<[string, string]>; actions?: ReactNode; menuAction?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const band = useRef<HTMLElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();
  const active = useActiveSection(nav.map(([id]) => id));

  useEffect(() => {
    const el = band.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
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
          <img className="lg lg-bbb" src="/brand/bbb-logo-w.webp" width={204} height={220} alt="Being, Becoming, Belonging: Reimagining the Self, Space and Society" />
          <Link to="/" className="lg lg-icw" onClick={() => pathname === '/' && window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img src="/brand/icw-logo.webp" width={560} height={242} alt="International Conference on Women" />
          </Link>
          <img className="lg lg-gio" src="/brand/gio-logo-white.webp" width={299} height={220} alt="GIO Keralam" />
        </div>
      </header>

      <div className={`hdr${stuck || open ? ' is-scrolled' : ''}`}>
        <div className="wrap hdr-in">
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
                </svg>
                {open ? 'Close' : 'Menu'}
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
 * page has scrolled most of a screen. `raised` lifts it above the mobile
 * register bar.
 */
export function BackToTop({ raised }: { raised?: boolean }) {
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
      className={`to-top${show ? ' show' : ''}${raised ? ' raised' : ''}`}
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

/** Small two-tone leaf set beside the theme words. */
export function LeafMark() {
  const id = `leaf${useId().replace(/:/g, '')}`;
  return (
    <svg className="leaf" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#b5475a" />
          <stop offset="1" stopColor="#f2b58f" />
        </linearGradient>
      </defs>
      <path d="M5 27C4 15 12 5 27 4c1 13-8 23-22 23z" fill={`url(#${id})`} />
      <path d="M7 25C12 19 17 13.5 23 8.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
