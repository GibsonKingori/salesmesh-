import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import './index.css';

function Root() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 650);
    return () => clearTimeout(t);
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        {!booted && <SplashScreen />}
        <div className={booted ? 'animate-fade-in' : 'opacity-0'}>
          <App />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
