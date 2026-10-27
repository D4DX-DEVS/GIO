import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { Link, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  ChevronDown,
  FileText,
  Globe,
  HelpCircle,
  ImageIcon,
  Images,
  LayoutGrid,
  Megaphone,
  Mic,
  ChevronRight,
  ExternalLink,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Menu,
  SendHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import type { Stats } from '../../lib/types';
import { Avatar, Button, Dialog, cx, useToast } from '../../components/ui';

type LayoutContext = { stats: Stats | null; refreshStats: () => void };
export const useLayout = () => useOutletContext<LayoutContext>();

type NavItem = {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  // Which list query this item stands for; null = the unfiltered dashboard.
  match: Record<string, string> | null;
  count?: (s: Stats) => number;
  tone?: 'warn' | 'danger';
};

// Website pages are matched by path rather than by list query.
const WEBSITE_NAV: NavItem[] = [
  { label: 'Overview', to: '/admin/website/overview', icon: LayoutGrid, match: null },
  { label: 'Page content', to: '/admin/website', icon: FileText, match: null },
  { label: 'Programme', to: '/admin/website/programme', icon: CalendarClock, match: null },
  { label: 'Speakers', to: '/admin/website/speakers', icon: Mic, match: null },
  { label: 'Announcements', to: '/admin/website/announcements', icon: Megaphone, match: null },
  { label: 'FAQs', to: '/admin/website/faqs', icon: HelpCircle, match: null },
  { label: 'Gallery', to: '/admin/website/gallery', icon: ImageIcon, match: null },
  { label: 'Images', to: '/admin/website/images', icon: Images, match: null },
];

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Overview',
    items: [{ label: 'Dashboard', to: '/admin', icon: LayoutDashboard, match: null }],
  },
  {
    group: 'Workflow',
    items: [
      { label: 'Awaiting confirmation', to: '/admin?status=submitted', icon: Hourglass, match: { status: 'submitted' }, count: (s) => s.awaitingConfirmation, tone: 'warn' },
      { label: 'Confirmed', to: '/admin?status=confirmed', icon: BadgeCheck, match: { status: 'confirmed' } },
      { label: 'Entry passes sent', to: '/admin?passStatus=sent', icon: SendHorizontal, match: { passStatus: 'sent' } },
      { label: 'Pass send failed', to: '/admin?passStatus=send_failed', icon: TriangleAlert, match: { passStatus: 'send_failed' }, count: (s) => s.passSendFailed, tone: 'danger' },
    ],
  },
];

function isActive(item: NavItem, pathname: string, search: string) {
  if (item.to.startsWith('/admin/website')) return pathname.replace(/\/$/, '') === item.to;
  if (pathname !== '/admin') return item.match === null && pathname.startsWith('/admin/registrations');
  const params = new URLSearchParams(search);
  const keys = ['status', 'passStatus'];
  if (item.match === null) return keys.every((k) => !params.get(k));
  return keys.every((k) => (params.get(k) ?? '') === (item.match![k] ?? ''));
}

function Nav({ stats, onNavigate }: { stats: Stats | null; onNavigate?: () => void }) {
  const { pathname, search } = useLocation();
  const { admin } = useAuth();
  const groups = admin?.permissions.includes('content') ? [...NAV, { group: 'Website', items: WEBSITE_NAV }] : NAV;
  return (
    <nav aria-label="Main" className="space-y-6">
      {groups.map(({ group, items }) => (
        <div key={group}>
          <p className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">{group}</p>
          <div className="space-y-0.5">
            {items.map((item) => {
              const active = isActive(item, pathname, search);
              const n = stats && item.count ? item.count(stats) : 0;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'group relative flex min-h-[42px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition duration-150',
                    active ? 'bg-brand-50 font-semibold text-brand-700' : 'font-medium text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
                  )}
                >
                  {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-600" />}
                  <item.icon className={cx('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600')} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {n > 0 && (
                    <span
                      className={cx(
                        'min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums',
                        item.tone === 'danger' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200'
                      )}
                    >
                      {n}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/admin" onClick={onNavigate} className="flex items-center gap-3 rounded-lg" aria-label="GIO Keralam admin console, dashboard">
      <img src="/brand/gio-logo-maroon.png" alt="" width={600} height={441} className="h-10 w-auto" />
      <span className="border-l border-slate-200 pl-3 leading-tight">
        <span className="block font-serif text-[19px] leading-none text-slate-900">Conference</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-500">Admin console</span>
      </span>
    </Link>
  );
}

function SidebarBody({ stats, onNavigate }: { stats: Stats | null; onNavigate?: () => void }) {
  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <Nav stats={stats} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-slate-200/70 p-3">
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="group block rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-brand-200 hover:bg-brand-50/60"
        >
          <span className="flex items-center justify-between text-sm font-semibold text-slate-900">
            Conference website
            <ExternalLink className="h-4 w-4 text-brand-600 transition group-hover:translate-x-0.5" aria-hidden />
          </span>
          <span className="mt-1 block text-xs text-slate-500">Open the public page. The form is at /register.</span>
        </a>
      </div>
    </>
  );
}

const PAGE_TITLES: Array<[RegExp, string, string]> = [
  [/^\/admin\/website\/overview/, 'Website overview', 'Every landing page section at a glance'],
  [/^\/admin\/website\/?$/, 'Page content', 'Landing page, event details and registration form rules'],
  [/^\/admin\/website\/programme/, 'Programme', 'Sessions and breaks'],
  [/^\/admin\/website\/speakers/, 'Speakers', 'Conference speakers'],
  [/^\/admin\/website\/announcements/, 'Announcements', 'News on the website'],
  [/^\/admin\/website\/faqs/, 'FAQs', 'Questions and answers'],
  [/^\/admin\/website\/gallery/, 'Gallery', 'Gallery images'],
  [/^\/admin\/website\/images/, 'Images', 'Image library'],
  [/^\/admin\/registrations\//, 'Registration details', 'Review, confirm and manage the entry pass'],
  [/^\/admin\/?$/, 'Dashboard', 'Registrations, confirmations and entry passes'],
];

function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const { admin } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!admin) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          'flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 transition hover:bg-slate-100 sm:pr-3',
          open && 'bg-slate-100'
        )}
      >
        <Avatar name={admin.name} className="h-9 w-9 text-xs ring-2 ring-white" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[9rem] truncate text-sm font-semibold text-slate-900">{admin.name}</span>
          <span className="block text-[11px] font-medium capitalize text-slate-500">{admin.role}</span>
        </span>
        <ChevronDown className={cx('hidden h-4 w-4 text-slate-400 transition-transform sm:block', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 origin-top-right animate-pop-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
            <Avatar name={admin.name} className="h-10 w-10 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{admin.name}</p>
              <p className="truncate text-xs text-slate-500">@{admin.username}</p>
            </div>
            <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-brand-700 ring-1 ring-inset ring-brand-100">{admin.role}</span>
          </div>
          <div className="p-1.5">
            <Link role="menuitem" to="/admin" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              <LayoutDashboard className="h-4 w-4 text-slate-400" aria-hidden /> Dashboard
            </Link>
            <a role="menuitem" href="/" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              <Globe className="h-4 w-4 text-slate-400" aria-hidden /> Conference website
            </a>
            <a role="menuitem" href="/register" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              <ExternalLink className="h-4 w-4 text-slate-400" aria-hidden /> Registration form
            </a>
          </div>
          <div className="border-t border-slate-100 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" aria-hidden /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminLayout() {
  const { logout } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const refreshStats = useCallback(() => {
    api<Stats>('/api/admin/stats').then(setStats).catch(() => {});
  }, []);
  useEffect(refreshStats, [refreshStats, location.pathname]);
  useEffect(() => setDrawer(false), [location.pathname, location.search]);

  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [drawer]);

  const [, title, subtitle] = PAGE_TITLES.find(([rx]) => rx.test(location.pathname)) ?? [null, 'Admin', ''];
  const alerts = stats ? stats.passSendFailed : 0;
  const onDetail = location.pathname.startsWith('/admin/registrations/');
  const onWebsite = location.pathname.startsWith('/admin/website');

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[4.5rem] shrink-0 items-center border-b border-slate-200/70 px-5">
          <Brand />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarBody stats={stats} />
        </div>
      </aside>

      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] animate-slide-in flex-col bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-lift">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/70 px-4">
              <Brand onNavigate={() => setDrawer(false)} />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarBody stats={stats} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-[17rem]">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-slate-50/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-3 px-3 sm:px-6 lg:h-[4.5rem] lg:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="hidden items-center gap-1 text-xs font-medium text-slate-400 sm:flex">
                <Link to="/admin" className="hover:text-brand-700">
                  Admin
                </Link>
                <ChevronRight className="h-3 w-3" aria-hidden />
                {onWebsite ? (
                  <>
                    <Link to="/admin/website" className="hover:text-brand-700">
                      Website
                    </Link>
                    <ChevronRight className="h-3 w-3" aria-hidden />
                    <span className="text-slate-500">{title}</span>
                  </>
                ) : onDetail ? (
                  <>
                    <Link to="/admin" className="hover:text-brand-700">
                      Registrations
                    </Link>
                    <ChevronRight className="h-3 w-3" aria-hidden />
                    <span className="text-slate-500">Details</span>
                  </>
                ) : (
                  <span className="text-slate-500">Dashboard</span>
                )}
              </p>
              <h1 className="display truncate text-[24px] leading-tight sm:text-[28px]">{title}</h1>
              <p className="sr-only">{subtitle}</p>
            </div>
            <Link
              to="/admin?passStatus=send_failed"
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              aria-label={alerts ? `${alerts} entry pass${alerts === 1 ? '' : 'es'} failed to send` : 'No failed sends'}
              title={alerts ? `${alerts} failed to send` : 'No failed sends'}
            >
              <Bell className="h-5 w-5" aria-hidden />
              {alerts > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {alerts}
                </span>
              )}
            </Link>
            <ProfileMenu onLogout={() => setConfirmLogout(true)} />
          </div>
        </header>

        <Outlet context={{ stats, refreshStats } satisfies LayoutContext} />
      </div>

      <Dialog
        open={confirmLogout}
        title="Log out?"
        description="You will need to sign in again to manage registrations."
        icon={
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <LogOut className="h-5 w-5" aria-hidden />
          </span>
        }
        onClose={() => setConfirmLogout(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLogout(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await logout();
                } catch {
                  toast('error', 'Could not reach the server; you have been signed out on this device.');
                } finally {
                  setBusy(false);
                  setConfirmLogout(false);
                }
              }}
            >
              Log out
            </Button>
          </>
        }
      />
    </div>
  );
}
