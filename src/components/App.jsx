import React, { useState, useEffect, lazy, Suspense } from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import { authService } from '../services/authService';
import '../styles/App.css';

// Lazy-loaded pages (same folder — no path prefix needed)
const HomePage  = lazy(() => import('./HomePage'));
const Login     = lazy(() => import('./Login'));
const Register  = lazy(() => import('./Register'));
const Dashboard = lazy(() => import('./Dashboard'));

// Full-page loading spinner
const PageSpinner = () => (
  <div style={{
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-page)',
  }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ width: 42, height: 42 }} />
      <span style={{ fontSize: '.9rem' }}>Loading…</span>
    </div>
  </div>
);

const App = () => {
  const [page,  setPage]  = useState('home');
  const [user,  setUser]  = useState(null);
  const [ready, setReady] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    const token = authService.getToken();
    const saved = localStorage.getItem('ft_user');
    if (token && saved) {
      try {
        setUser(JSON.parse(saved));
        setPage('dashboard');
      } catch { /* corrupted JSON — ignore */ }
    }
    setReady(true);
  }, []);

  const handleLogin = (userData, token) => {
    authService.setToken(token);
    localStorage.setItem('ft_user', JSON.stringify(userData));
    setUser(userData);
    setPage('dashboard');
  };

  const handleLogout = () => {
    authService.logout();
    localStorage.removeItem('ft_user');
    setUser(null);
    setPage('home');
  };

  const handleRegisterSuccess = () => {
    setPage('login');
  };

  if (!ready) return <PageSpinner />;

  return (
    <ThemeProvider>
      <Suspense fallback={<PageSpinner />}>
        {page === 'home'      && <HomePage   onLogin={() => setPage('login')} onRegister={() => setPage('register')} />}
        {page === 'login'     && <Login      onLogin={handleLogin} onSwitchToRegister={() => setPage('register')} prefillEmail={localStorage.getItem('lastRegisteredEmail') || ''} />}
        {page === 'register'  && <Register   onRegisterSuccess={handleRegisterSuccess} onSwitchToLogin={() => setPage('login')} />}
        {page === 'dashboard' && user        && <Dashboard user={user} onLogout={handleLogout} />}
      </Suspense>
    </ThemeProvider>
  );
};

export default App;