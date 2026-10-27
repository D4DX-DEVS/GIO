import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Landing from './pages/Landing';
import Register from './pages/Register';
import Login from './pages/admin/Login';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import RegistrationDetail from './pages/admin/RegistrationDetail';
import PageContent from './pages/admin/website/PageContent';
import ItemsPage, { KINDS } from './pages/admin/website/ItemsPage';
import Images from './pages/admin/website/Images';
import Overview from './pages/admin/website/Overview';
import { AuthProvider, RequireAuth, RequirePermission } from './lib/auth';
import { ToastProvider } from './components/ui';

function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="font-semibold text-brand-700 underline">
        Go to the conference page
      </Link>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/register" element={<Register />} />
          <Route path="/registration" element={<Navigate to="/register" replace />} />
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
                    <Route path="website" element={<RequirePermission permission="content" />}>
                      <Route index element={<PageContent />} />
                      <Route path="overview" element={<Overview />} />
                      <Route path="images" element={<Images />} />
                      {Object.keys(KINDS).map((slug) => (
                        <Route key={slug} path={slug} element={<ItemsPage key={slug} slug={slug} />} />
                      ))}
                    </Route>
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
