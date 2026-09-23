import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import DealsPage from './pages/DealsPage.jsx';
import CampaignsPage from './pages/manager/CampaignsPage.jsx';
import SettingsPage from './pages/manager/SettingsPage.jsx';

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
  if (user.role === 'representative') return <Navigate to="/rep" replace />;
  return <Navigate to="/manager" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RoleRedirect />} />

      <Route path="/manager" element={<ProtectedRoute allowedRoles={['manager', 'admin']} />}>
        <Route index element={<OverviewPage key="team" scope="team" />} />
        <Route path="deals" element={<DealsPage key="team" scope="team" />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/rep" element={<ProtectedRoute allowedRoles={['representative']} />}>
        <Route index element={<OverviewPage key="mine" scope="mine" />} />
        <Route path="deals" element={<DealsPage key="mine" scope="mine" />} />
      </Route>

      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}
