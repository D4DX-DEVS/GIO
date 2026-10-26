import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BadgeCheck, KeyRound, UserRound } from 'lucide-react';
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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(50rem_30rem_at_50%_-10%,theme(colors.brand.100),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-900/20">
            <BadgeCheck className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to the registration admin console</p>
        </div>
        <div className="card p-6 shadow-lift">
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
        <p className="mt-6 text-center text-xs text-slate-400">Admin accounts are created by the system administrator.</p>
      </div>
    </main>
  );
}
