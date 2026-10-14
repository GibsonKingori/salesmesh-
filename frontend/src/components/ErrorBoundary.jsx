import React from 'react';
import { LogoMark } from './Logo.jsx';

// Without this, an error while drawing any page leaves a blank white screen. main.jsx keys it by
// the URL, so going to another page (or Back) clears the error.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-fg">
        <LogoMark className="h-12 w-12" />
        <h1 className="font-display text-lg font-semibold">Something went wrong on this page</h1>
        <p className="max-w-sm text-sm text-muted">
          Your data is safe. Reload to try again, or go back to your dashboard.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500"
          >
            Reload
          </button>
          <a
            href="/"
            className="rounded-lg border border-fg/10 bg-fg/5 px-4 py-2 text-sm font-medium text-fg-soft transition-colors hover:border-fg/20 hover:bg-fg/10 hover:text-fg"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    );
  }
}
