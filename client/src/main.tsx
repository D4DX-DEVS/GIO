import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './index.css';
import Register from './pages/Register';
import Login from './pages/admin/Login';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import RegistrationDetail from './pages/admin/RegistrationDetail';
import { AuthProvider, RequireAuth } from './lib/auth';
import { ToastProvider } from './components/ui';

function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="font-semibold text-brand-700 underline">
        Go to the registration form
      </Link>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Register />} />
          <Route
            path="/admin/*"
            element={
              <AuthProvider>
                <Routes>
                  <Route path="login" element={<Login />} />
                  <Route
                    element={
                      <RequireAuth>
                        <AdminLayout />
                      </RequireAuth>
                    }
                  >
                    <Route index element={<Dashboard />} />
                    <Route path="registrations/:id" element={<RegistrationDetail />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AuthProvider>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
