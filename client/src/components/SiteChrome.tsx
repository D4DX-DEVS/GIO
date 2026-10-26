// Header and decorative pieces shared by the public website and the
// registration page (styles in site.css).
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { SiteImage } from '../lib/types';

export function useScrolled(px = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > px);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [px]);
  return scrolled;
}

/**
 * Sticky header: logo, section links and a call to action. Below 960px the
 * links move into a menu that closes on Escape, on a link and on resize.
 */
export function SiteHeader({ logo, nav = [], actions, menuAction }: { logo: SiteImage | null; nav?: Array<[string, string]>; actions?: ReactNode; menuAction?: ReactNode }) {
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const { pathname } = useLocation();

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
    <header className={`hdr${scrolled || open ? ' is-scrolled' : ''}`}>
      <div className="wrap hdr-in">
        <Link
          to="/"
          className="logo"
          aria-label={logo?.alt || 'GIO Keralam'}
          onClick={() => pathname === '/' && window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          {logo ? <img src={logo.url} alt={logo.alt} width={logo.width} height={logo.height} /> : <b>GIO Keralam</b>}
        </Link>
        {nav.length > 0 && (
          <nav className="nav" aria-label="Sections">
            {nav.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        )}
        <div className="hdr-actions">
          {actions}
          {nav.length > 0 && (
            <button type="button" className="menu-btn" aria-expanded={open} aria-controls={menuId} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
              </svg>
            </button>
          )}
        </div>
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
    </header>
  );
}

/** Line drawing of concentric arcs and a leaf, after the poster and logo. */
export function Flourish({ className = '' }: { className?: string }) {
  return (
    <svg className={`flourish ${className}`} viewBox="0 0 600 600" aria-hidden="true" focusable="false">
      <circle cx="300" cy="300" r="296" pathLength={1} />
      <circle cx="300" cy="300" r="228" pathLength={1} />
      <path d="M300 300 m-160 0 a160 160 0 1 1 160 160" pathLength={1} />
      <path d="M300 128 C392 196 404 330 300 446 C196 330 208 196 300 128 Z" pathLength={1} />
      <path d="M300 152 L300 430" pathLength={1} />
    </svg>
  );
}

/** Small leaf mark used in empty states. */
export function Leaf() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22.5" />
      <path d="M24 9c7 5.5 8 16 0 27-8-11-7-21.5 0-27z" />
      <path d="M24 12v23" />
    </svg>
  );
}
