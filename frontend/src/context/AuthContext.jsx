import React, { createContext, useContext, useState } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('salesmesh_user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('salesmesh_token', data.token);
    localStorage.setItem('salesmesh_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  // company is { joinCode } to join an existing company, or { companyName } to start one
  const register = async (name, email, password, company) => {
    await api.post('/auth/register', { name, email, password, ...company });
    return login(email, password);
  };

  // Tells the API first (for the audit log), then clears the session even if that call fails
  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // expired token or API down: signing out locally is still right
    }
    localStorage.removeItem('salesmesh_token');
    localStorage.removeItem('salesmesh_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
