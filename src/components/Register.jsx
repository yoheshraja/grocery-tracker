import React, { useState } from 'react';
import { authService } from '../services/authService';
import '../styles/App.css';
import './Auth.css';

const Register = ({ onRegisterSuccess, onSwitchToLogin }) => { 
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredUser, setRegisteredUser] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const validatePhone = (phone) => {
    const phoneRegex = /^[0-9]{10}$/;
    return phone === '' || phoneRegex.test(phone);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setRegistrationSuccess(false);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (!validatePhone(formData.phone)) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);

    try {
      console.log('📤 Sending registration request...');
      
      const result = await authService.register({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        password: formData.password
      });
      
      console.log('📥 Registration response:', result);
      
      if (result.token && result.user) {
        // Show success message
        setRegistrationSuccess(true);
        setRegisteredUser({
          email: formData.email,
          name: formData.name
        });
        
        // Clear form
        setFormData({
          name: '',
          email: '',
          phone: '',
          password: '',
          confirmPassword: ''
        });
        
        // Save email for pre-fill in login
        localStorage.setItem('lastRegisteredEmail', formData.email);
        
        // Notify parent about successful registration (optional)
        if (onRegisterSuccess) {
          onRegisterSuccess(result.user, result.token);
        }
        
      } else {
        setError(result.message || 'Registration failed');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    // Save email to localStorage for pre-fill
    if (registeredUser?.email) {
      localStorage.setItem('lastRegisteredEmail', registeredUser.email);
    }
    
    // Switch to login page
    onSwitchToLogin();
  };

  if (registrationSuccess) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="logo-circle">
              <i className="fas fa-leaf"></i>
            </div>
            <h1>Registration Successful! 🎉</h1>
            <p className="subtitle">Your account has been created</p>
          </div>

          <div className="success-container">
            <div className="success-animation">
              <div className="checkmark-circle">
                <div className="checkmark"></div>
              </div>
              <h3>Welcome to ExpireTrack!</h3> 
              <p className="success-message">
                Hi <strong>{registeredUser?.name}</strong>, your account is ready.
              </p>
              
              <div className="success-details">
                <div className="detail-item">
                  <i className="fas fa-envelope"></i>
                  <div>
                    <strong>Email:</strong>
                    <span>{registeredUser?.email}</span>
                  </div>
                </div>
                <div className="detail-item">
                  <i className="fas fa-check-circle"></i>
                  <div>
                    <strong>Status:</strong>
                    <span>Account activated</span>
                  </div>
                </div>
                <div className="detail-item">
                  <i className="fas fa-bell"></i>
                  <div>
                    <strong>Notifications:</strong>
                    <span>Expiry alerts enabled</span>
                  </div>
                </div>
              </div>

              <div className="action-buttons">
                <button 
                  onClick={handleGoToLogin}
                  className="auth-button primary"
                >
                  <i className="fas fa-sign-in-alt"></i>
                  Continue to Login
                </button>
                
                <button 
                  onClick={() => {
                    setRegistrationSuccess(false);
                    setRegisteredUser(null);
                  }}
                  className="auth-button secondary"
                >
                  <i className="fas fa-user-plus"></i>
                  Register Another Account
                </button>
              </div>
              
              <div className="login-instructions">
                <h4><i className="fas fa-info-circle"></i> Next Steps:</h4>
                <ol>
                  <li>Click "Continue to Login" above</li>
                  <li>Your email will be pre-filled</li>
                  <li>Enter your password to continue</li>
                  <li>Start tracking your groceries!</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo-circle">
            <i className="fas fa-leaf"></i>
          </div>
          <h1>Join ExpireTrack</h1>
          <p className="subtitle">Track groceries, reduce waste, save money</p>
        </div>

        {error && (
          <div className="error-message slide-in">
            <i className="fas fa-exclamation-circle"></i>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group floating-label">
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              disabled={loading}
              placeholder=" "
            />
            <label>Full Name</label>
            <i className="fas fa-user input-icon"></i>
          </div>

          <div className="input-group floating-label">
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              disabled={loading}
              placeholder=" "
            />
            <label>Email Address</label>
            <i className="fas fa-envelope input-icon"></i>
          </div>

          <div className="input-group floating-label">
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder=" "
              disabled={loading}
            />
            <label>Phone Number (Optional)</label>
            <i className="fas fa-phone input-icon"></i>
            <small className="input-hint">For SMS notifications - 10 digits only</small>
          </div>

          <div className="input-group floating-label">
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              disabled={loading}
              placeholder=" "
            />
            <label>Password</label>
            <i className="fas fa-lock input-icon"></i>
            <small className="input-hint">Minimum 6 characters</small>
          </div>

          <div className="input-group floating-label">
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
              disabled={loading}
              placeholder=" "
            />
            <label>Confirm Password</label>
            <i className="fas fa-lock input-icon"></i>
          </div>

          <div className="password-requirements">
            <h5>Password Requirements:</h5>
            <ul>
              <li className={formData.password.length >= 6 ? 'valid' : ''}>
                <i className={formData.password.length >= 6 ? 'fas fa-check-circle' : 'fas fa-circle'}></i>
                At least 6 characters
              </li>
              <li className={formData.password === formData.confirmPassword && formData.password ? 'valid' : ''}>
                <i className={formData.password === formData.confirmPassword && formData.password ? 'fas fa-check-circle' : 'fas fa-circle'}></i>
                Passwords match
              </li>
            </ul>
          </div>

          <button 
            type="submit" 
            className="auth-button primary"
            disabled={loading}
          >
            {loading ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Creating Account...
              </>
            ) : (
              <>
                <i className="fas fa-user-plus"></i>
                Create Free Account
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>Already have an account?</p>
          <button onClick={onSwitchToLogin} className="auth-button secondary">
            <i className="fas fa-sign-in-alt"></i>
            Sign In to Existing Account
          </button>
        </div>

        <div className="features-grid">
          <div className="feature">
            <i className="fas fa-bell"></i>
            <span>Smart Notifications</span>
            <small>7, 3, 1 day alerts</small>
          </div>
          <div className="feature">
            <i className="fas fa-camera"></i>
            <span>Barcode Scan</span>
            <small>Quick product entry</small>
          </div>
          <div className="feature">
            <i className="fas fa-chart-line"></i>
            <span>Track Savings</span>
            <small>Reduce food waste</small>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
