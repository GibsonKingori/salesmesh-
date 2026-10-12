import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import './index.css';

// The splash shows only while the first page's code downloads. With v7_startTransition, later
// navigations keep the current page on screen until the next one is ready instead of flashing it.
function Root() {
  return (
    <BrowserRouter future={{ v7_startTransition: true }}>
      <AuthProvider>
        <Suspense fallback={<SplashScreen />}>
          <div className="animate-fade-in">
            <App />
          </div>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
