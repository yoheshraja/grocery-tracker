import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import { authService } from './services/authService';
import './styles/App.css';
import './styles/App.css';
import './components/Auth.css';
import './components/Dashboard.css';
function App() {
  
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      authService.setToken(savedToken);
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    authService.setToken(authToken);
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleRegister = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    authService.setToken(authToken);
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    authService.setToken(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
  };

  const switchToRegister = () => setIsRegistering(true);
  const switchToLogin = () => setIsRegistering(false);

  if (loading) {
    return (
      <div className="loading-screen">
        <i className="fas fa-spinner fa-spin"></i>
        <p>Loading...</p>
      </div>
    );
  }
 const handleProductScanned = (product) => {
    console.log('Scanned product:', product);
    // Add to your database or state
  };

  
  return (
    <div className="App">
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <>
          {isRegistering ? (
            <Register 
              onRegister={handleRegister}
              onSwitchToLogin={switchToLogin}
            />
          ) : (
            <Login 
              onLogin={handleLogin}
              onSwitchToRegister={switchToRegister}
            />
          )}
      
        </>
      )}
    </div>
  );
}

export default App;