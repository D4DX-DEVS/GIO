import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronDown, Info, Loader2, Search, X } from 'lucide-react';
import type { PassStatus, Status } from '../lib/types';
import { PASS_LABEL, STATUS_LABEL, initials } from '../lib/format';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type IconType = ComponentType<{ className?: string }>;

// --- Button -------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-900/10 hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-500/30 disabled:bg-brand-600/50',
  secondary:
    'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 focus-visible:ring-slate-400/25 disabled:text-slate-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500/30 disabled:bg-red-600/50',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400/25',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:ring-brand-500/25 disabled:text-brand-700/50',
};

const SIZES = {
  lg: 'min-h-[52px] px-6 text-base rounded-xl',
  md: 'min-h-[44px] px-4 text-sm rounded-xl',
  sm: 'min-h-[36px] px-3 text-[13px] rounded-lg',
  icon: 'h-9 w-9 rounded-lg',
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  size?: keyof typeof SIZES;
};

export function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 font-semibold transition duration-150 focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed',
        SIZES[size],
        VARIANTS[variant],
        className
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cx('flex items-center justify-center gap-2 py-12 text-sm text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative block overflow-hidden rounded-md bg-slate-200/70 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent',
        className
      )}
    />
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-brand-200 font-semibold text-brand-800',
        className ?? 'h-10 w-10 text-sm'
      )}
    >
      {initials(name) || '?'}
    </span>
  );
}

// --- Form field ---------------------------------------------------------------

type FieldControlProps = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; 'aria-required'?: boolean };

export function Field({
  label,
  error,
  hint,
  icon: Icon,
  required,
  valid,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  icon?: IconType;
  required?: boolean;
  valid?: boolean;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="text-red-500" aria-hidden>
            *
          </span>
        )}
      </label>
      <div className="relative">
        {Icon && (
          <span
            className={cx(
              'pointer-events-none absolute left-3.5 top-1/2 z-[1] -translate-y-1/2 transition-colors',
              error ? 'text-red-400' : valid ? 'text-emerald-500' : 'text-slate-400'
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        )}
        {children({
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          'aria-required': required || undefined,
        })}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex animate-fade-in items-start gap-1.5 text-[13px] font-medium text-red-600">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// --- Combobox -----------------------------------------------------------------

/**
 * Text input with a suggestion list. Typing filters the list; the value is
 * whatever is typed or picked, so the form's own validation decides whether
 * it is one of the options.
 */
export function Combobox({
  id,
  name,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  invalid,
  valid,
  withIcon,
  emptyText = 'No matches',
  ...aria
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: string[];
  placeholder?: string;
  invalid?: boolean;
  valid?: boolean;
  withIcon?: boolean;
  emptyText?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;

  const exact = options.find((o) => o.toLowerCase() === value.trim().toLowerCase());
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    // After a pick, reopening shows the whole list with the pick highlighted.
    if (!q || exact) return options;
    const starts = options.filter((o) => o.toLowerCase().startsWith(q));
    const contains = options.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [options, value, exact]);

  useEffect(() => {
    if (!open) return;
    const i = exact ? filtered.indexOf(exact) : 0;
    setActive(Math.max(0, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function pick(option: string) {
    onChange(option);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      return setActive((a) => (filtered.length ? (a + step + filtered.length) % filtered.length : 0));
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active]);
      return undefined;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
    if (e.key === 'Tab' && open) setOpen(false);
    return undefined;
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        {...aria}
        ref={inputRef}
        id={id}
        name={name}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        placeholder={placeholder}
        className={cx('input pr-11', withIcon && 'pl-11', invalid && 'input-error', valid && 'input-valid')}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // A typed value that matches an option, ignoring case, takes the option's spelling.
          if (exact && exact !== value) onChange(exact);
          if (!wrapRef.current?.contains(e.relatedTarget as Node)) onBlur?.();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Close list' : 'Show list'}
        onClick={() => {
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <ChevronDown className={cx('h-5 w-5 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 origin-top animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift">
          {!exact && value.trim() && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2 text-xs text-slate-500">
              <Search className="h-3.5 w-3.5" aria-hidden />
              {filtered.length} suggestion{filtered.length === 1 ? '' : 's'} for “{value.trim()}”
            </div>
          )}
          <ul ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
            {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{emptyText}</li>}
            {filtered.map((o, i) => {
              const selected = o === exact;
              return (
                <li
                  key={o}
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cx(
                    'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-[15px] transition-colors',
                    i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-700',
                    selected && 'font-semibold'
                  )}
                >
                  {o}
                  {selected && <Check className="h-4 w-4 text-brand-600" aria-hidden />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Badges -------------------------------------------------------------------

const STATUS_STYLE: Record<Status, string> = {
  submitted: 'bg-amber-50 text-amber-800 ring-amber-200/80 [--dot:theme(colors.amber.500)]',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80 [--dot:theme(colors.emerald.500)]',
};

const PASS_STYLE: Record<PassStatus, string> = {
  not_generated: 'bg-slate-50 text-slate-500 ring-slate-200 [--dot:theme(colors.slate.300)]',
  generated: 'bg-violet-50 text-violet-800 ring-violet-200/80 [--dot:theme(colors.violet.500)]',
  sent: 'bg-sky-50 text-sky-800 ring-sky-200/80 [--dot:theme(colors.sky.500)]',
  send_failed: 'bg-red-50 text-red-700 ring-red-200/80 [--dot:theme(colors.red.500)]',
};

const badge =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset before:h-1.5 before:w-1.5 before:rounded-full before:bg-[var(--dot)]';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={cx(badge, STATUS_STYLE[status])}>{STATUS_LABEL[status] ?? status}</span>;
}

export function PassBadge({ status }: { status: PassStatus }) {
  return <span className={cx(badge, PASS_STYLE[status] ?? PASS_STYLE.not_generated)}>{PASS_LABEL[status] ?? status}</span>;
}

// --- Alert --------------------------------------------------------------------

export function Alert({
  tone = 'error',
  title,
  children,
  action,
}: {
  tone?: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex animate-fade-in flex-wrap items-start gap-3 rounded-xl border p-3.5 text-sm sm:flex-nowrap', styles)}
    >
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: IconType; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col items-center px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-4 font-semibold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// --- Dialog -------------------------------------------------------------------

export function Dialog({
  open,
  title,
  description,
  icon,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Kept in a ref so an inline onClose does not re-run the effect (and steal focus) on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>('textarea, button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && node) {
        const items = node.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, select, a[href]');
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-3xl bg-white shadow-lift sm:animate-pop-in sm:rounded-2xl',
          size === 'lg' ? 'sm:max-w-lg' : 'sm:max-w-md'
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-5 pb-1 pt-4 sm:px-6 sm:pt-6">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && <div className="mt-1 text-sm text-slate-500">{description}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children && <div className="overflow-y-auto px-5 py-3 text-sm text-slate-600 sm:px-6">{children}</div>}
        {footer && (
          <div className="flex flex-col-reverse gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:px-6 sm:pb-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Toasts -------------------------------------------------------------------

type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastContext = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

const TOAST_ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const TOAST_TONE = { success: 'text-emerald-500', error: 'text-red-500', info: 'text-sky-500' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((all) => all.filter((x) => x.id !== id));
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:bottom-0 sm:left-auto sm:top-auto sm:items-end sm:p-5"
      >
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 shadow-lift"
            >
              <Icon className={cx('mt-0.5 h-[18px] w-[18px] shrink-0', TOAST_TONE[t.tone])} aria-hidden />
              <p className="min-w-0 flex-1">{t.text}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
