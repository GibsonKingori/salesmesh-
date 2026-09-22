import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import NetworkMesh from '../components/NetworkMesh.jsx';

const ROLES = [
  { value: 'representative', label: 'Sales Representative' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('representative');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [welcomeName, setWelcomeName] = useState(null);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const isRegister = mode === 'register';

  const switchMode = (next) => {
    setMode(next);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = isRegister ? await register(name, email, password, role) : await login(email, password);
      setWelcomeName(user.name);
      setTimeout(() => {
        navigate(user.role === 'representative' ? '/rep' : '/manager');
      }, 650);
    } catch (err) {
      setError(err.response?.data?.error || (isRegister ? 'Registration failed' : 'Login failed'));
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-brand-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-brand-500/15';

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-slate-950">
      <div className="bg-grid pointer-events-none fixed inset-0" />

      {/* Brand panel */}
      <div className="relative z-10 hidden w-1/2 lg:flex">
        <NetworkMesh className="pointer-events-none absolute right-0 top-0 h-full w-full text-brand-400/70" />
        <div className="relative flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold">
              S
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">SalesMesh</span>
          </div>

          <div className="max-w-md animate-fade-in-up space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live pipeline sync
            </span>
            <h1 className="font-display text-4xl font-bold leading-tight text-white">
              Sales analytics built for Kenyan SMEs.
            </h1>
            <p className="text-sm leading-relaxed text-slate-400">
              Track deals, manage your pipeline, and see where every campaign shilling goes —
              all in one dashboard your whole team can trust.
            </p>
          </div>

          <p className="text-xs text-slate-500">&copy; {new Date().getFullYear()} SalesMesh. All rights reserved.</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative z-10 flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm animate-fade-in-up rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-2xl">
          <div className="mb-8 text-center lg:text-left">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 font-bold text-white lg:hidden">
              S
            </div>
            <h2 className="font-display text-2xl font-bold text-white">
              {isRegister ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {isRegister ? 'Set up access for your sales team.' : 'Log in to see your pipeline and deals.'}
            </p>
          </div>

          <div className="mb-6 flex rounded-lg border border-white/10 bg-white/5 p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                !isRegister ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                isRegister ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            {isRegister && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Full name</label>
                <input
                  type="text"
                  placeholder="Gibson Kingori"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Email</label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
                minLength={6}
              />
            </div>

            {isRegister && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value} className="bg-slate-900">
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => switchMode(isRegister ? 'login' : 'register')}
              className="font-medium text-brand-300 hover:text-brand-200"
            >
              {isRegister ? 'Log in' : 'Register'}
            </button>
          </p>
        </div>
      </div>

      {welcomeName && (
        <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-slate-950/95 backdrop-blur-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 font-display text-lg font-bold text-white">
            {welcomeName[0]?.toUpperCase()}
          </div>
          <p className="text-sm text-slate-300">Welcome, {welcomeName}</p>
        </div>
      )}
    </div>
  );
}
