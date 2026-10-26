import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api';
import type { AdminProfile } from './types';
import { Spinner } from '../components/ui';

type AuthState = {
  admin: AdminProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ admin: AdminProfile }>('/api/auth/me')
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  // Any 401 from the API (expired or revoked session) signs the user out.
  useEffect(() => {
    setUnauthorizedHandler(() => setAdmin(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ admin: AdminProfile }>('/api/auth/login', { method: 'POST', body: { username, password } });
    setAdmin(r.admin);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setAdmin(null);
    }
  }, []);

  return <AuthContext.Provider value={{ admin, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking session" />;
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
