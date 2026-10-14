import React, { lazy, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';

// Each page is its own download, so the first load doesn't wait for every page and the chart
// library. main.jsx shows the splash only for the very first page; after that the current page
// stays on screen while the next one downloads.
const loaders = [];
const RELOAD_KEY = 'salesmesh_chunk_reload';
function lazyPage(load) {
  loaders.push(load);
  return lazy(() =>
    load()
      .then((page) => {
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          /* storage unavailable */
        }
        return page;
      })
      .catch((err) => {
        // A tab opened before the app was rebuilt or the dev server restarted asks for page files
        // that no longer exist. Reload once to get the current ones instead of showing a blank page.
        let reloaded = true;
        try {
          reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
          if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
        } catch {
          /* storage unavailable: don't risk a reload loop */
        }
        if (!reloaded) {
          window.location.reload();
          return new Promise(() => {}); // keep the splash up until the reload happens
        }
        throw err;
      })
  );
}

// Once the app is idle, download the remaining pages so moving between them is instant
function usePreloadPages() {
  useEffect(() => {
    const preload = () => loaders.forEach((load) => load().catch(() => {}));
    const id = window.requestIdleCallback ? window.requestIdleCallback(preload) : setTimeout(preload, 1500);
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(id) : clearTimeout(id));
  }, []);
}
const ManagerOverviewPage = lazyPage(() => import('./pages/manager/ManagerOverviewPage.jsx'));
const RepOverviewPage = lazyPage(() => import('./pages/rep/RepOverviewPage.jsx'));
const DealsPage = lazyPage(() => import('./pages/DealsPage.jsx'));
const ContactsPage = lazyPage(() => import('./pages/ContactsPage.jsx'));
const CampaignsPage = lazyPage(() => import('./pages/manager/CampaignsPage.jsx'));
const CampaignResultsPage = lazyPage(() => import('./pages/CampaignResultsPage.jsx'));
const AdminOverviewPage = lazyPage(() => import('./pages/admin/AdminOverviewPage.jsx'));
const AccountsPage = lazyPage(() => import('./pages/admin/AccountsPage.jsx'));
const AccountDetailPage = lazyPage(() => import('./pages/admin/AccountDetailPage.jsx'));
const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage.jsx'));
const ConfigurationPage = lazyPage(() => import('./pages/admin/ConfigurationPage.jsx'));
const AuditLogPage = lazyPage(() => import('./pages/admin/AuditLogPage.jsx'));
import { HOME_BY_ROLE } from './lib/roles.js';

function ProtectedRoute({ allowedRoles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
}

export default function App() {
  usePreloadPages();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<RoleRedirect />} />

      <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']} />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="accounts/:id" element={<AccountDetailPage />} />
        {/* Old link from before Accounts replaced Roles & permissions */}
        <Route path="roles" element={<Navigate to="/admin/accounts" replace />} />
        <Route path="configuration" element={<ConfigurationPage />} />
        <Route path="audit" element={<AuditLogPage />} />
      </Route>

      <Route path="/manager" element={<ProtectedRoute allowedRoles={['manager']} />}>
        <Route index element={<ManagerOverviewPage />} />
        <Route path="deals" element={<DealsPage key="team" scope="team" />} />
        <Route path="contacts" element={<ContactsPage key="team" scope="team" />} />
        <Route path="campaigns" element={<CampaignsPage />} />
      </Route>

      <Route path="/rep" element={<ProtectedRoute allowedRoles={['representative']} />}>
        <Route index element={<RepOverviewPage />} />
        <Route path="deals" element={<DealsPage key="mine" scope="mine" />} />
        <Route path="contacts" element={<ContactsPage key="mine" scope="mine" />} />
        <Route path="campaigns" element={<CampaignResultsPage />} />
      </Route>

      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}
