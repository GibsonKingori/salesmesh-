import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ManagerDashboard from './pages/manager/ManagerDashboard.jsx';
import RepresentativeDashboard from './pages/representative/RepresentativeDashboard.jsx';

function ProtectedRoute({ children, allowedRoles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
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
      <Route
        path="/manager"
        element={
          <ProtectedRoute allowedRoles={['manager', 'admin']}>
            <ManagerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rep"
        element={
          <ProtectedRoute allowedRoles={['representative']}>
            <RepresentativeDashboard />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
