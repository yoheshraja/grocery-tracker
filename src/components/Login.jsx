import React, { useState, useEffect } from 'react';
import { authService } from '../services/authService';
import ForgotPassword from './ForgotPassword';
import '../styles/App.css';
import './Auth.css';
const Login = ({ onLogin, onSwitchToRegister, prefillEmail = '' }) => {
  const [formData, setFormData] = useState({ 
    email: prefillEmail,
    password: '' 
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  // Update when prefillEmail changes
  useEffect(() => {
    if (prefillEmail) {
      setFormData(prev => ({ ...prev, email: prefillEmail }));
      // Focus on password field when email is pre-filled
      setTimeout(() => {
        document.querySelector('input[name="password"]')?.focus();
      }, 100);
    }
  }, [prefillEmail]);

  // Load remembered email on component mount
  useEffect(() => {
    const rememberedEmail = localStorage.getItem('rememberedEmail');
    if (rememberedEmail && !prefillEmail) {
      setFormData(prev => ({ ...prev, email: rememberedEmail }));
      setRememberMe(true);
    }
  }, [prefillEmail]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleRememberMe = (e) => {
    setRememberMe(e.target.checked);
    if (!e.target.checked) {
      localStorage.removeItem('rememberedEmail');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await authService.login(formData);
      if (result.token) {
        // Save email if remember me is checked
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', formData.email);
        }
        
        onLogin(result.user, result.token);
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle forgot password
  const handleForgotPassword = () => {
    setResetEmail(formData.email); // Save current email
    setShowForgotPassword(true);
  };

  const handleForgotPasswordSuccess = (email) => {
    // Pre-fill the email in login form after successful password reset
    setFormData(prev => ({ ...prev, email }));
    setShowForgotPassword(false);
    setError('Password reset successful! Please login with your new password.');
  };

  const handleBackToLogin = () => {
    setShowForgotPassword(false);
    setError('');
  };

  // If showing forgot password, render that component instead
  if (showForgotPassword) {
    return (
      <ForgotPassword
        email={resetEmail}
        onBackToLogin={handleBackToLogin}
        onSuccess={handleForgotPasswordSuccess}
      />
    );
  }

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <div className="auth-header">
          <div className="logo-circle">
            <i className="fas fa-leaf"></i>
          </div>
          <h1>Welcome Back</h1>
          <p className="subtitle">Sign in to continue to FreshTrack</p>
          
          {prefillEmail && (
            <div className="prefill-notice">
              <i className="fas fa-check-circle"></i>
              Account created! Please enter your password
            </div>
          )}
        </div>

        {error && (
          <div className={`message ${error.includes('successful') ? 'success-message' : 'error-message'} slide-in`}>
            <i className={`fas fa-${error.includes('successful') ? 'check' : 'exclamation'}-circle`}></i>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group floating-label">
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              disabled={loading}
              autoComplete="username"
            />
            <label>Email Address</label>
            <i className="fas fa-envelope input-icon"></i>
          </div>

          <div className="input-group floating-label">
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              disabled={loading}
              autoComplete="current-password"
              placeholder=" "
            />
            <label>Password</label>
            <i className="fas fa-lock input-icon"></i>
          </div>

          <div className="form-options">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={handleRememberMe}
                disabled={loading}
              />
              <span>Remember me</span>
            </label>
            
            <button 
              type="button"
              onClick={handleForgotPassword}
              className="forgot-password"
              disabled={loading}
            >
              <i className="fas fa-question-circle"></i>
              Forgot password?
            </button>
          </div>

          <button 
            type="submit" 
            className="auth-button primary"
            disabled={loading}
          >
            {loading ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Signing In...
              </>
            ) : (
              <>
                <i className="fas fa-sign-in-alt"></i>
                Sign In
              </>
            )}
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <div className="auth-footer">
          <p>Don't have an account?</p>
          <button 
            onClick={onSwitchToRegister} 
            className="auth-button secondary"
            disabled={loading}
          >
            <i className="fas fa-user-plus"></i>
            Create New Account
          </button>
        </div>

        <div className="security-notice">
          <i className="fas fa-shield-alt"></i>
          <span>Your data is securely encrypted</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
