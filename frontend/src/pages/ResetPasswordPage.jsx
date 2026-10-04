import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import AuthCard, { authButtonClass, authInputClass } from '../components/AuthCard.jsx';

const MIN_LENGTH = 8;
const linkClass = 'font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200';

// Step 2 of a password reset: the link carries a single-use token; the user picks a new password
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset your password. Please try again.');
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title="Reset link missing" subtitle="This page needs the link you were given.">
        <p className="text-center text-sm text-muted">
          <Link to="/forgot-password" className={linkClass}>
            Request a new reset link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="You'll use it the next time you log in.">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}{' '}
            {/expired|invalid/i.test(error) && (
              <Link to="/forgot-password" className="font-medium underline">
                Get a new link
              </Link>
            )}
          </div>
        )}

        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-fg-soft">
            New password
          </label>
          <input
            id="new-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            autoFocus
            required
          />
          <p className={`mt-1 text-xs ${tooShort ? 'text-red-700 dark:text-red-300' : 'text-subtle'}`}>At least {MIN_LENGTH} characters.</p>
        </div>

        <div>
          <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-fg-soft">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={authInputClass}
            autoComplete="new-password"
            required
          />
          {mismatch && <p className="mt-1 text-xs text-red-700 dark:text-red-300">Doesn't match the password above.</p>}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-brand-600" />
          Show passwords
        </label>

        <button type="submit" disabled={loading || tooShort || mismatch} className={authButtonClass}>
          {loading ? 'Saving…' : 'Set new password'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        <Link to="/login" className={linkClass}>
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
