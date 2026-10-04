import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import AuthCard, { authButtonClass, authInputClass } from '../components/AuthCard.jsx';

const linkClass = 'font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200';

// Step 1 of a password reset: ask for the account's email.
// Until SalesMesh sends email, the API returns the reset link in development and this page
// goes straight to it; otherwise the user is told to ask their administrator for a link.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      if (data.resetPath) {
        navigate(data.resetPath);
        return;
      }
      setMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start the reset. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Forgot your password?" subtitle="Enter the email you log in with and we'll help you set a new one.">
      {message ? (
        <div className="space-y-4 text-sm">
          <p className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-emerald-800 dark:text-emerald-200">{message}</p>
          <p className="text-muted">
            Didn't get a link? Ask your SalesMesh administrator — they can create one for you from the Accounts page.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
          )}
          <div>
            <label htmlFor="reset-email" className="mb-1 block text-sm font-medium text-fg-soft">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
              autoFocus
              required
            />
          </div>
          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading ? 'Please wait…' : 'Continue'}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        Remembered it?{' '}
        <Link to="/login" className={linkClass}>
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
