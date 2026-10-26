import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { CalendarDays, Check, Copy, MapPin } from 'lucide-react';
import { api, ApiError, errorMessage, newIdempotencyKey } from '../lib/api';
import type { PublicConfig } from '../lib/types';
import { instantError, matchDistrict, validateAll, validateField } from '../lib/validation';
import type { Errors, FieldKey, FormValues, Rules } from '../lib/validation';
import { Alert, Button, Combobox, Dialog, Field, Skeleton, cx } from '../components/ui';

const EMPTY: FormValues = { name: '', age: '', mobile: '', email: '', district: '', area: '', unit: '' };
const FIELDS = Object.keys(EMPTY) as FieldKey[];

type Success = { regNo: string; name: string; mobile: string };

export default function Register() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<Success | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // One key per filled-in form: a double tap or a retry after a network
  // error is recognised by the server as the same submission.
  const idempotencyKey = useRef(newIdempotencyKey());
  const honeypot = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const loadConfig = () => {
    setConfigError('');
    api<PublicConfig>('/api/public/config')
      .then((c) => {
        setConfig(c);
        document.title = `Register · ${c.eventName}`;
      })
      .catch((err) => setConfigError(errorMessage(err)));
  };
  useEffect(loadConfig, []);

  const rules: Rules = {
    ageMin: config?.ageMin ?? 10,
    ageMax: config?.ageMax ?? 100,
    districts: config?.districts ?? [],
    country: config?.countries.find((c) => c.dial === config.defaultCountryCode),
  };
  const shown = (k: FieldKey) => touched[k] || submitAttempted;
  const errorFor = (k: FieldKey) =>
    serverErrors[k] || (shown(k) ? validateField(k, values[k], rules) : instantError(k, values[k])) || undefined;
  const isValid = (k: FieldKey) => shown(k) && !errorFor(k) && values[k].trim() !== '';
  const dirty = FIELDS.some((k) => values[k].trim() !== '');

  const set = (k: FieldKey, v: string) => {
    setValues((all) => ({ ...all, [k]: v }));
    setServerErrors((s) => ({ ...s, [k]: undefined }));
    setFormError('');
  };
  const update = (k: FieldKey) => (e: ChangeEvent<HTMLInputElement>) => set(k, e.target.value);
  const blur = (k: FieldKey) => () => setTouched((t) => ({ ...t, [k]: true }));

  function reset() {
    setValues(EMPTY);
    setTouched({});
    setSubmitAttempted(false);
    setServerErrors({});
    setFormError('');
    idempotencyKey.current = newIdempotencyKey();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitAttempted(true);
    setFormError('');
    const errs = validateAll(values, rules);
    if (Object.keys(errs).length) {
      const first = FIELDS.find((k) => errs[k]);
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: values.name.trim(),
        age: values.age.trim(),
        mobile: values.mobile.trim(),
        email: values.email.trim(),
        district: matchDistrict(values.district, rules.districts) ?? values.district.trim(),
        area: values.area.trim(),
        unit: values.unit.trim(),
        ...(honeypot.current?.value ? { website: honeypot.current.value } : {}),
      };
      const res = await api<{ regNo: string; name: string }>('/api/public/registrations', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      setSuccess({ regNo: res.regNo, name: res.name, mobile: values.mobile.trim() });
      reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setServerErrors(err.fields as Errors);
        const first = FIELDS.find((k) => err.fields?.[k]);
        if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      }
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const input = (k: FieldKey) => cx('input', errorFor(k) && 'input-error', isValid(k) && 'input-valid');

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="bg-brand-900 px-4 pb-24 pt-[max(2rem,env(safe-area-inset-top))] text-white sm:pt-12">
        <div className="mx-auto max-w-xl">
          {config ? (
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{config.eventName}</h1>
          ) : (
            <Skeleton className="h-8 w-3/4 bg-white/15" />
          )}
          {(config?.eventDate || config?.eventVenue) && (
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-brand-100">
              {config.eventDate && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" aria-hidden /> {config.eventDate}
                </span>
              )}
              {config.eventVenue && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden /> {config.eventVenue}
                </span>
              )}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto -mt-16 w-full max-w-xl px-4 pb-12">
        <div className="rounded-2xl border border-slate-200/70 bg-white shadow-lift">
          {!config && !configError && (
            <div className="space-y-4 p-6" aria-busy>
              <Skeleton className="h-6 w-48" />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          )}
          {configError && (
            <div className="p-6">
              <Alert
                title="The form could not be loaded"
                action={
                  <Button variant="secondary" size="sm" onClick={loadConfig}>
                    Try again
                  </Button>
                }
              >
                {configError}
              </Alert>
            </div>
          )}

          {config && success && <SuccessPanel success={success} onAgain={() => setSuccess(null)} />}

          {config && !success && !config.registrationOpen && (
            <div className="p-6">
              <Alert tone="info" title="Registrations are closed">
                Registration for this event is not open at the moment.
              </Alert>
            </div>
          )}

          {config && !success && config.registrationOpen && (
            <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5 p-5 sm:p-7">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Registration form</h2>
                <p className="mt-0.5 text-sm text-slate-500">All fields are required.</p>
              </div>

              <Field label="Full name" error={errorFor('name')} valid={isValid('name')}>
                {(p) => (
                  <input
                    {...p}
                    name="name"
                    className={input('name')}
                    autoComplete="name"
                    autoCapitalize="words"
                    placeholder="Your full name"
                    maxLength={120}
                    value={values.name}
                    onChange={update('name')}
                    onBlur={blur('name')}
                  />
                )}
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-[8rem_1fr]">
                <Field label="Age" error={errorFor('age')} valid={isValid('age')}>
                  {(p) => (
                    <input
                      {...p}
                      name="age"
                      className={input('age')}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="Age"
                      maxLength={3}
                      value={values.age}
                      onChange={update('age')}
                      onBlur={blur('age')}
                    />
                  )}
                </Field>
                <Field label="Mobile number" error={errorFor('mobile')} valid={isValid('mobile')}>
                  {(p) => (
                    <input
                      {...p}
                      name="mobile"
                      type="tel"
                      className={input('mobile')}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="tel-national"
                      placeholder="10-digit mobile number"
                      maxLength={15}
                      value={values.mobile}
                      onChange={update('mobile')}
                      onBlur={blur('mobile')}
                    />
                  )}
                </Field>
              </div>

              <Field label="Email address" error={errorFor('email')} valid={isValid('email')}>
                {(p) => (
                  <input
                    {...p}
                    name="email"
                    type="email"
                    className={input('email')}
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="name@example.com"
                    maxLength={200}
                    value={values.email}
                    onChange={update('email')}
                    onBlur={blur('email')}
                  />
                )}
              </Field>

              <Field label="District" error={errorFor('district')} valid={isValid('district')}>
                {(p) => (
                  <Combobox
                    {...p}
                    name="district"
                    options={rules.districts}
                    placeholder="Select or type your district"
                    emptyText="No district matches. Pick one from the list."
                    invalid={Boolean(errorFor('district'))}
                    valid={isValid('district')}
                    value={values.district}
                    onChange={(v) => set('district', v)}
                    onBlur={blur('district')}
                  />
                )}
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Area" error={errorFor('area')} valid={isValid('area')}>
                  {(p) => (
                    <input
                      {...p}
                      name="area"
                      className={input('area')}
                      autoComplete="off"
                      autoCapitalize="words"
                      placeholder="Your area"
                      maxLength={100}
                      value={values.area}
                      onChange={update('area')}
                      onBlur={blur('area')}
                    />
                  )}
                </Field>
                <Field label="Unit" error={errorFor('unit')} valid={isValid('unit')}>
                  {(p) => (
                    <input
                      {...p}
                      name="unit"
                      className={input('unit')}
                      autoComplete="off"
                      autoCapitalize="words"
                      placeholder="Your unit"
                      maxLength={100}
                      value={values.unit}
                      onChange={update('unit')}
                      onBlur={blur('unit')}
                    />
                  )}
                </Field>
              </div>

              {/* Honeypot for bots: hidden from people and assistive technology. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>

              {formError && <Alert>{formError}</Alert>}

              <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
                <Button type="submit" size="lg" loading={submitting} className="w-full sm:flex-1">
                  {submitting ? 'Submitting…' : 'Submit registration'}
                </Button>
                <Button variant="ghost" size="lg" onClick={() => setConfirmClear(true)} disabled={submitting || !dirty} className="w-full sm:w-auto">
                  Clear
                </Button>
              </div>
            </form>
          )}
        </div>

        {config?.supportContact && (
          <p className="mt-6 text-center text-sm text-slate-500">
            Need help? Contact <span className="font-medium text-slate-700">{config.supportContact}</span>
          </p>
        )}
      </main>

      <Dialog
        open={confirmClear}
        title="Clear the form?"
        description="Everything you have entered will be removed. Nothing has been submitted."
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmClear(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmClear(false);
              }}
            >
              Clear form
            </Button>
          </>
        }
      />
    </div>
  );
}

function SuccessPanel({ success, onAgain }: { success: Success; onAgain: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(success.regNo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available; the number is visible anyway */
    }
  };
  return (
    <div className="animate-fade-up px-5 py-8 text-center sm:px-8" role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="h-7 w-7" strokeWidth={3} aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">Registration submitted</h2>
      <p className="mt-2 text-slate-600">Thank you, {success.name}. Please keep your registration number.</p>

      <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 py-2 pl-5 pr-2">
        <span className="font-mono text-xl font-bold tracking-wider">{success.regNo}</span>
        <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy registration number">
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <p className="mx-auto mt-5 max-w-sm text-sm text-slate-600">
        Your registration is not confirmed yet. Once it is confirmed, your entry pass will be sent on WhatsApp to {success.mobile}.
      </p>

      <Button variant="secondary" className="mt-6 w-full sm:w-auto" onClick={onAgain}>
        Register another person
      </Button>
    </div>
  );
}
