import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import NetworkMesh from '../components/NetworkMesh.jsx';
import Logo, { LogoMark } from '../components/Logo.jsx';
import { HOME_BY_ROLE } from '../lib/roles.js';

const FEATURES = [
  { title: 'Prioritised pipeline', text: 'Every open deal scored, so your team knows who to call next.' },
  { title: 'Campaign ROI', text: 'See what each campaign shilling brings back in won deals.' },
  { title: 'Revenue forecast', text: 'A forward view built from the deals you actually close.' },
];

// Joining needs the company's join code (from its admin) and makes you a Sales Rep;
// starting a company makes you its admin
const SIGNUP_OPTIONS = [
  { value: 'join', label: 'Join a company' },
  { value: 'create', label: 'Start a company' },
];

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState('join'); // 'join' | 'create'
  const [joinCode, setJoinCode] = useState('');
  const [companyName, setCompanyName] = useState('');
  // api/client.js sends users here with ?expired=1 or ?disabled=1; the reset page with ?reset=1
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('disabled')) return 'Your account has been disabled. Contact your administrator.';
    if (params.has('expired')) return 'Your session expired. Please log in again.';
    return '';
  });
  const [notice, setNotice] = useState(() =>
    new URLSearchParams(window.location.search).has('reset') ? 'Password changed. Log in with your new password.' : ''
  );
  const [loading, setLoading] = useState(false);
  const [welcomeName, setWelcomeName] = useState(null);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const isRegister = mode === 'register';

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const company = signup === 'join' ? { joinCode } : { companyName };
      const user = isRegister ? await register(name, email, password, company) : await login(email, password);
      setWelcomeName(user.name);
      setTimeout(() => {
        navigate(HOME_BY_ROLE[user.role] || '/');
      }, 650);
    } catch (err) {
      setError(err.response?.data?.error || (isRegister ? 'Registration failed' : 'Login failed'));
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-faint outline-none transition-all focus:border-brand-400/50 focus:bg-surface focus:ring-2 focus:ring-brand-500/15';

  return (
    // h-screen + a scrolling form column: the brand panel never stretches with a taller
    // (register) form, so its copy stays centred in the viewport in both modes
    <div className="relative flex h-screen overflow-hidden bg-canvas">
      <div className="bg-aurora pointer-events-none fixed inset-0" />
      <div className="bg-grid pointer-events-none fixed inset-0" />

      {/* Brand panel */}
      <div className="dark no-scrollbar relative z-10 hidden h-full w-1/2 overflow-y-auto bg-canvas lg:block">
        <div className="bg-aurora pointer-events-none absolute inset-0" />
        <div className="bg-grid pointer-events-none absolute inset-0" />
        {/* Faded on the left so the mesh never competes with the copy on top of it */}
        <NetworkMesh className="pointer-events-none absolute right-0 top-0 h-full w-full text-brand-400 [mask-image:linear-gradient(to_left,black_35%,rgba(0,0,0,0.3)_85%)]" />
        <div className="relative flex min-h-full w-full flex-col justify-between gap-10 p-12 text-fg [@media(max-height:720px)]:p-8">
          <Logo markClassName="h-10 w-10" textClassName="text-lg" />

          <div className="max-w-md animate-fade-in-up space-y-6">
            <span className="inline-flex items-center gap-2.5 rounded-full border border-brand-300/50 bg-brand-500/20 px-3.5 py-1.5 text-sm font-semibold text-brand-50 shadow-[0_0_20px_-4px_rgba(38,211,160,0.6)]">
              {/* live pulse: a ping ring behind a solid gold dot */}
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-400" />
              </span>
              Built for Kenyan SMEs
            </span>
            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-fg">
              Sales analytics for the <span className="text-gradient">next generation</span> of Kenyan business.
            </h1>
            <p className="text-sm leading-relaxed text-fg-soft">
              Track deals, manage your pipeline, and see where every campaign shilling goes — all in one
              dashboard your whole team can trust.
            </p>
            <ul className="space-y-3 pt-2 [@media(max-height:640px)]:hidden">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400 shadow-[0_0_10px_2px_rgba(38,211,160,0.5)]" />
                  <p className="text-sm text-muted">
                    <span className="font-medium text-fg">{f.title}.</span> {f.text}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-subtle">&copy; {new Date().getFullYear()} SalesMesh · Nairobi, Kenya</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative z-10 flex h-full w-full overflow-y-auto px-6 lg:w-1/2">
        {/* m-auto centres the card when it fits and lets it scroll when it doesn't */}
        <div className="m-auto w-full max-w-sm animate-fade-in-up py-12">
          <div className="rounded-2xl border border-fg/10 bg-surface p-8 shadow-xl shadow-ink-900/10">
            <div className="mb-8 text-center">
              <LogoMark className="mx-auto mb-4 h-11 w-11 lg:hidden" />
              <h2 className="font-display text-2xl font-bold tracking-tight text-fg">
                {isRegister ? 'Create your account' : 'Welcome back'}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {isRegister ? 'Set up access for your sales team.' : 'Log in to see your pipeline and deals.'}
              </p>
            </div>

            <div className="mb-6 flex rounded-lg border border-fg/10 bg-fg/5 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`flex-1 rounded-md py-1.5 transition-colors ${
                  !isRegister ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`flex-1 rounded-md py-1.5 transition-colors ${
                  isRegister ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                  {notice}
                </div>
              )}

              {isRegister && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-soft">Full name</label>
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
                <label className="mb-1 block text-sm font-medium text-fg-soft">Email</label>
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
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="block text-sm font-medium text-fg-soft">Password</label>
                  {!isRegister && (
                    <Link
                      to="/forgot-password"
                      className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  required
                  minLength={isRegister ? 8 : undefined}
                />
                {isRegister && (
                  <p className="mt-1 text-xs text-subtle">
                    At least 8 characters.
                  </p>
                )}
              </div>

              {isRegister && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-soft">Company</label>
                  <div className="mb-2 flex rounded-lg border border-fg/10 bg-fg/5 p-1 text-sm font-medium">
                    {SIGNUP_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSignup(opt.value)}
                        aria-pressed={signup === opt.value}
                        className={`flex-1 rounded-md py-1.5 transition-colors ${
                          signup === opt.value ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {signup === 'join' ? (
                    <>
                      <input
                        type="text"
                        placeholder="Join code, e.g. ACME2345"
                        aria-label="Company join code"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        className={`${inputClass} font-mono uppercase tracking-wider`}
                        autoComplete="off"
                        required
                      />
                      <p className="mt-1 text-xs text-subtle">
                        Ask your company’s admin for the code. You’ll join as a Sales Rep; the admin can change your role.
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Company name"
                        aria-label="Company name"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className={inputClass}
                        required
                      />
                      <p className="mt-1 text-xs text-subtle">
                        You’ll be the company’s admin, with a join code to share with your team.
                      </p>
                    </>
                  )}
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

            <p className="mt-6 text-center text-sm text-muted">
              {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => switchMode(isRegister ? 'login' : 'register')}
                className="font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
              >
                {isRegister ? 'Log in' : 'Register'}
              </button>
            </p>
          </div>
        </div>
      </div>

      {welcomeName && (
        <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-canvas/95 backdrop-blur-sm">
          <LogoMark className="h-12 w-12" />
          <p className="text-sm text-fg-soft">Welcome, {welcomeName}</p>
        </div>
      )}
    </div>
  );
}
