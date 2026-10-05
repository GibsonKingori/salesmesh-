import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ManagerOverviewPage from './pages/manager/ManagerOverviewPage.jsx';
import RepOverviewPage from './pages/rep/RepOverviewPage.jsx';
import DealsPage from './pages/DealsPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import CampaignsPage from './pages/manager/CampaignsPage.jsx';
import CampaignResultsPage from './pages/CampaignResultsPage.jsx';
import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx';
import AccountsPage from './pages/admin/AccountsPage.jsx';
import AccountDetailPage from './pages/admin/AccountDetailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import ConfigurationPage from './pages/admin/ConfigurationPage.jsx';
import AuditLogPage from './pages/admin/AuditLogPage.jsx';
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
