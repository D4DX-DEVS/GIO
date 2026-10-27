import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, UserRound } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/api';
import { Alert, Button, Field } from '../../components/ui';

export default function Login() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/admin';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (admin) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-[25rem] animate-fade-up">
        <div className="mb-7 flex flex-col items-center text-center">
          <img src="/brand/gio-logo-maroon.png" alt="GIO Keralam" width={600} height={441} className="h-16 w-auto" />
          <p className="kicker mt-6">International Conference on Women</p>
          <h1 className="display mt-2 text-[40px] leading-none">Admin sign in</h1>
          <span aria-hidden className="mt-5 block h-0.5 w-12 bg-brand-600" />
          <p className="mt-4 text-sm text-slate-500">Registrations, entry passes and the conference website</p>
        </div>
        <div className="card p-6 shadow-lift sm:p-7">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field label="Username" icon={UserRound}>
              {(p) => (
                <input
                  {...p}
                  className="input pl-11"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}
            </Field>
            <Field label="Password" icon={KeyRound}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  className="input pl-11"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">Admin accounts are created by the system administrator.</p>
        <p className="mt-3 text-center text-xs">
          <a href="/" className="font-semibold text-brand-600 underline-offset-4 hover:underline">
            Go to the conference website
          </a>
        </p>
      </div>
    </main>
  );
}
