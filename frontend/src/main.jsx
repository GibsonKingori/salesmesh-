import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
// Fonts ship with the app (not Google Fonts) so it looks the same without internet
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import './index.css';

// The splash shows only while the first page's code downloads. With v7_startTransition, later
// navigations keep the current page on screen until the next one is ready instead of flashing it.
function Root() {
  return (
    <BrowserRouter future={{ v7_startTransition: true }}>
      <AuthProvider>
        <PageErrorBoundary>
          <Suspense fallback={<SplashScreen />}>
            <div className="animate-fade-in">
              <App />
            </div>
          </Suspense>
        </PageErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

// A new key on navigation remounts the boundary, so a crash on one page doesn't stick to the next
function PageErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
