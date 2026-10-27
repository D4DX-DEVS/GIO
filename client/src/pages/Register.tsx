import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import '../site.css';
import { api, ApiError, errorMessage, newIdempotencyKey } from '../lib/api';
import type { PublicConfig, PublicPage, PublicSite } from '../lib/types';
import { FALLBACK_SITE, plain } from '../lib/site';
import { FIELD_ORDER, childAgeError, instantError, matchDistrict, validateAll, validateField } from '../lib/validation';
import type { Errors, FieldKey, FormValues, Rules } from '../lib/validation';
import { Button, Dialog } from '../components/ui';
import { BackToTop, SiteHeader } from '../components/SiteChrome';

const EMPTY: FormValues = { name: '', age: '', gender: '', place: '', district: '', area: '', unit: '', mobile: '', whatsapp: '', email: '' };

const ADULTS_NOTE = 'Any accompanying adults must register separately.';

type Success = { regNo: string; name: string; whatsapp: string };

export default function Register() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [page, setPage] = useState<PublicPage>(FALLBACK_SITE.page);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [sameAsMobile, setSameAsMobile] = useState(true);
  const [childrenCount, setChildrenCount] = useState(0);
  const [childAges, setChildAges] = useState<string[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
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
  useEffect(() => {
    api<PublicSite>('/api/public/site')
      .then((s) => setPage(s.page))
      .catch(() => {});
  }, []);

  const rules: Rules = {
    ageMin: config?.ageMin ?? 10,
    ageMax: config?.ageMax ?? 100,
    districts: config?.districts ?? [],
    country: config?.countries.find((c) => c.dial === config.defaultCountryCode),
    genderOptions: config?.genderOptions ?? [],
    placeRequired: config?.placeRequired ?? true,
    children: config?.children ?? null,
    sameAsMobile,
  };

  const shown = (k: string) => touched[k] || submitAttempted;
  const errorFor = (k: FieldKey) =>
    serverErrors[k] || (shown(k) ? validateField(k, values[k], rules) : instantError(k, values[k])) || undefined;
  const ageErrorFor = (i: number) =>
    serverErrors[`childAges.${i}`] || (shown(`childAges.${i}`) ? childAgeError(childAges[i] ?? '', rules) : undefined);
  const dirty = FIELD_ORDER.some((k) => values[k].trim() !== '') || childrenCount > 0 || !sameAsMobile;

  const clearServer = (k: string) => {
    setServerErrors((s) => ({ ...s, [k]: undefined }));
    setFormError('');
  };
  const set = (k: FieldKey, v: string) => {
    setValues((all) => ({ ...all, [k]: v }));
    clearServer(k);
  };
  const update = (k: FieldKey) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value);
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  function setCount(n: number) {
    setChildrenCount(n);
    setChildAges((a) => Array.from({ length: n }, (_, i) => a[i] ?? ''));
    clearServer('childrenCount');
  }

  function reset() {
    setValues(EMPTY);
    setSameAsMobile(true);
    setChildrenCount(0);
    setChildAges([]);
    setTouched({});
    setSubmitAttempted(false);
    setServerErrors({});
    setFormError('');
    idempotencyKey.current = newIdempotencyKey();
  }

  function focusFirst(errs: Errors) {
    const order = [...FIELD_ORDER, 'childrenCount', ...childAges.map((_, i) => `childAges.${i}`)];
    const first = order.find((k) => errs[k as keyof Errors]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !config) return;
    setSubmitAttempted(true);
    setFormError('');
    const errs = validateAll(values, childAges, rules);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        formVersion: config.formVersion,
        name: values.name.trim(),
        age: values.age.trim(),
        ...(rules.genderOptions.length ? { gender: values.gender } : {}),
        place: values.place.trim(),
        district: matchDistrict(values.district, rules.districts) ?? values.district.trim(),
        area: values.area.trim(),
        unit: values.unit.trim(),
        mobile: values.mobile.trim(),
        whatsappSameAsMobile: sameAsMobile,
        ...(sameAsMobile ? {} : { whatsapp: values.whatsapp.trim() }),
        email: values.email.trim(),
        ...(rules.children ? { childrenCount, childAges: childAges.map((a) => a.trim()) } : {}),
        ...(honeypot.current?.value ? { website: honeypot.current.value } : {}),
      };
      const res = await api<{ regNo: string; name: string }>('/api/public/registrations', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      setSuccess({ regNo: res.regNo, name: res.name, whatsapp: (sameAsMobile ? values.mobile : values.whatsapp).trim() });
      reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'form_outdated') {
        setFormError('This form was updated. Please reload the page; what you typed will need to be entered again.');
      } else {
        if (err instanceof ApiError && err.fields) {
          setServerErrors(err.fields as Errors);
          focusFirst(err.fields as Errors);
        }
        setFormError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fld = (k: FieldKey, label: string, input: (aria: { id: string; name: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => JSX.Element) => {
    const err = errorFor(k);
    return (
      <div className="fld">
        <label htmlFor={`r-${k}`}>{label}</label>
        {input({ id: `r-${k}`, name: k, 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `r-${k}-err` : undefined })}
        {err && (
          <p className="err" id={`r-${k}-err`}>
            {err}
          </p>
        )}
      </div>
    );
  };

  const text = (k: FieldKey, extra: Record<string, unknown> = {}) =>
    fld(k, LABELS[k], (aria) => <input {...aria} className="ctl" value={values[k]} onChange={update(k)} onBlur={blur(k)} {...extra} />);

  const genderErr = errorFor('gender');
  const countErr = serverErrors.childrenCount;
  const eventLine = [config?.eventDate, config?.eventVenue].filter(Boolean).join(' · ');

  return (
    <div className="site">
      <SiteHeader
        actions={
          <Link to="/" className="hdr-back">
            <span aria-hidden="true">←</span> Conference home
          </Link>
        }
      />

      <div className="reg-top">
        <div className="wrap">
          <p className="eyebrow">{config ? plain(config.eventName) : plain(page.title)}</p>
          <h1>Registration</h1>
          {eventLine && (
            <p className="event">
              {[config?.eventDate, config?.eventVenue].filter(Boolean).map((v) => (
                <span key={v}>{v}</span>
              ))}
            </p>
          )}
        </div>
      </div>

      <main className="wrap reg-layout">
        <div>
          <div className="fpaper">
            {!config && !configError && (
              <div aria-busy="true" style={{ display: 'grid', gap: 16 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="sk" style={{ height: 50 }} />
                ))}
                <span className="sr-only" role="status">
                  Loading the form…
                </span>
              </div>
            )}

            {configError && (
              <div role="alert">
                <p className="form-alert">The form could not be loaded. {configError}</p>
                <p style={{ marginTop: 16 }}>
                  <button type="button" className="btn-clear" onClick={loadConfig}>
                    Try again
                  </button>
                </p>
              </div>
            )}

            {config && success && <SuccessPanel success={success} onAgain={() => setSuccess(null)} />}

            {config && !success && !config.registrationOpen && (
              <div className="closed" role="status">
                <h2>Registrations are closed</h2>
                <p>Registration for this event is not open at the moment.</p>
              </div>
            )}

            {config && !success && config.registrationOpen && (
              <form ref={formRef} onSubmit={onSubmit} noValidate className="reg-form">
                <fieldset className="fsec">
                  <legend>About you</legend>
                  {text('name', { autoComplete: 'name', autoCapitalize: 'words', placeholder: 'Your full name', maxLength: 120 })}
                  <div className="grid2 grid-age">
                    {text('age', { inputMode: 'numeric', autoComplete: 'off', placeholder: 'Age', maxLength: 3 })}
                    {rules.genderOptions.length > 0 && (
                      <div className="fld">
                        <span className="lbl" id="r-gender-lbl">
                          Gender
                        </span>
                        <div
                          className="chips"
                          role="radiogroup"
                          aria-labelledby="r-gender-lbl"
                          aria-invalid={genderErr ? true : undefined}
                          aria-describedby={genderErr ? 'r-gender-err' : undefined}
                        >
                          {rules.genderOptions.map((g) => (
                            <label key={g} className="chip">
                              <input
                                type="radio"
                                name="gender"
                                value={g}
                                checked={values.gender === g}
                                onChange={() => {
                                  set('gender', g);
                                  blur('gender')();
                                }}
                              />
                              <span>{g}</span>
                            </label>
                          ))}
                        </div>
                        {genderErr && (
                          <p className="err" id="r-gender-err">
                            {genderErr}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </fieldset>

                <fieldset className="fsec">
                  <legend>Location</legend>
                  <div className="grid2">
                    {text('place', { autoCapitalize: 'words', autoComplete: 'address-level2', placeholder: 'Your place', maxLength: 100 })}
                    {fld('district', 'District', (aria) => (
                      <select {...aria} className="ctl" value={matchDistrict(values.district, rules.districts) ?? ''} onChange={update('district')} onBlur={blur('district')}>
                        <option value="">Select district</option>
                        {rules.districts.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                  <div className="grid2">
                    {text('area', { autoCapitalize: 'words', autoComplete: 'off', placeholder: 'Your area', maxLength: 100 })}
                    {text('unit', { autoCapitalize: 'words', autoComplete: 'off', placeholder: 'Your unit', maxLength: 100 })}
                  </div>
                </fieldset>

                <fieldset className="fsec">
                  <legend>Contact</legend>
                  <div className="grid2">
                    {text('mobile', { type: 'tel', inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'tel-national', placeholder: '10-digit mobile number', maxLength: 15 })}
                    {fld('whatsapp', 'WhatsApp number', (aria) => (
                      <>
                        <input
                          {...aria}
                          className="ctl"
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="10-digit WhatsApp number"
                          maxLength={15}
                          disabled={sameAsMobile}
                          value={sameAsMobile ? values.mobile : values.whatsapp}
                          onChange={update('whatsapp')}
                          onBlur={blur('whatsapp')}
                        />
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={sameAsMobile}
                            onChange={(e) => {
                              setSameAsMobile(e.target.checked);
                              clearServer('whatsapp');
                            }}
                          />
                          Same as phone number
                        </label>
                      </>
                    ))}
                  </div>
                  {text('email', { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false, placeholder: 'name@example.com', maxLength: 200 })}
                </fieldset>

                <fieldset className="fsec">
                  <legend>Accompanying children</legend>
                  {rules.children && (
                    <>
                      <div className="grid2">
                        <div className="fld">
                          <label htmlFor="r-childrenCount">Number of accompanying children</label>
                          <select
                            id="r-childrenCount"
                            name="childrenCount"
                            className="ctl"
                            value={childrenCount}
                            aria-invalid={countErr ? true : undefined}
                            aria-describedby={countErr ? 'r-childrenCount-err' : undefined}
                            onChange={(e) => setCount(Number(e.target.value))}
                          >
                            {Array.from({ length: rules.children.max + 1 }, (_, i) => (
                              <option key={i} value={i}>
                                {i}
                              </option>
                            ))}
                          </select>
                          {countErr && (
                            <p className="err" id="r-childrenCount-err">
                              {countErr}
                            </p>
                          )}
                        </div>
                      </div>
                      {childrenCount > 0 && (
                        <div className="kids">
                          {childAges.map((a, i) => {
                            const err = ageErrorFor(i);
                            const id = `r-childAges-${i}`;
                            return (
                              <div className="fld" key={i}>
                                <label htmlFor={id}>Age of child {i + 1}</label>
                                <input
                                  id={id}
                                  name={`childAges.${i}`}
                                  className="ctl"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  placeholder="Age"
                                  maxLength={2}
                                  value={a}
                                  aria-invalid={err ? true : undefined}
                                  aria-describedby={err ? `${id}-err` : undefined}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setChildAges((all) => all.map((x, j) => (j === i ? v : x)));
                                    clearServer(`childAges.${i}`);
                                  }}
                                  onBlur={blur(`childAges.${i}`)}
                                />
                                {err && (
                                  <p className="err" id={`${id}-err`}>
                                    {err}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  <p className="note-adults" role="note">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <circle cx="12" cy="12" r="9.5" />
                      <path d="M12 7.5v5.5M12 16.5v.5" />
                    </svg>
                    <span>{ADULTS_NOTE}</span>
                  </p>
                </fieldset>

                {/* Honeypot for bots: hidden from people and assistive technology. */}
                <div aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 0, height: 0, overflow: 'hidden' }}>
                  <label>
                    Website
                    <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>

                {formError && (
                  <p className="form-alert" role="alert">
                    {formError}
                  </p>
                )}

                <div className="actions">
                  <button type="submit" className="btn-submit" disabled={submitting} aria-busy={submitting || undefined}>
                    {submitting && <span className="spin" aria-hidden />}
                    {submitting ? 'Submitting…' : (
                      <>
                        Submit registration <span aria-hidden="true">→</span>
                      </>
                    )}
                  </button>
                  <button type="button" className="btn-clear" onClick={() => setConfirmClear(true)} disabled={submitting || !dirty}>
                    Clear
                  </button>
                </div>
              </form>
            )}
          </div>
          {config?.supportContact && <p className="help">Need help? Contact {config.supportContact}</p>}
        </div>

        {page.poster && (
          <aside className="reg-aside" aria-label="Conference">
            <img src={page.poster.url} alt={page.poster.alt} width={page.poster.width} height={page.poster.height} loading="lazy" />
            <dl>
              {[
                ['Date', page.dateText],
                ['Location', page.location],
                ['Venue', page.venue],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </aside>
        )}
      </main>
      <BackToTop />

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

const LABELS: Record<FieldKey, string> = {
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  place: 'Place',
  district: 'District',
  area: 'Area',
  unit: 'Unit',
  mobile: 'Phone number',
  whatsapp: 'WhatsApp number',
  email: 'Email',
};

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
    <div className="success" role="status">
      <span className="tick">
        <Check size={28} strokeWidth={3} aria-hidden />
      </span>
      <h2>Registration submitted</h2>
      <p>Thank you, {success.name}. Please keep your registration number.</p>
      <span className="regno">
        {success.regNo}
        <button type="button" onClick={copy} aria-label="Copy registration number">
          {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
        </button>
      </span>
      <p>Your registration is not confirmed yet. Once it is confirmed, your entry pass will be sent on WhatsApp to {success.whatsapp}.</p>
      <p className="again">
        <button type="button" className="btn-clear" onClick={onAgain}>
          Register another person
        </button>
        <Link to="/" className="btn-clear">
          Back to the conference page
        </Link>
      </p>
    </div>
  );
}
