import React, { useState } from 'react';
import { authService } from '../services/authService';
import '../styles/globals.css';
import './Auth.css';
const ForgotPassword = ({ onBackToLogin, onSuccess }) => {
  const [step, setStep] = useState(1); // 1: Email input, 2: OTP verification, 3: New password
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [otpSent, setOtpSent] = useState(false);

  // Start resend timer
  const startResendTimer = () => {
    setResendTimer(60);
    const timer = setInterval(() => {
      setResendTimer(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Handle send OTP
  const handleSendOTP = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccess('');
    
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.requestPasswordReset(email);
      if (result.success) {
        setSuccess('OTP sent to your email address');
        setOtpSent(true);
        startResendTimer();
        setStep(2);
      } else {
        setError(result.message || 'Failed to send OTP');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle resend OTP
  const handleResendOTP = async () => {
    if (resendTimer > 0) return;
    
    setError('');
    setLoading(true);
    try {
      const result = await authService.resendOTP(email);
      if (result.success) {
        setSuccess('OTP resent to your email');
        startResendTimer();
      } else {
        setError(result.message || 'Failed to resend OTP');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle verify OTP
  const handleVerifyOTP = async (e) => {
    e?.preventDefault();
    setError('');
    
    if (!otp || otp.length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.verifyOTP(email, otp);
      if (result.success) {
        setSuccess('OTP verified successfully');
        setStep(3);
      } else {
        setError(result.message || 'Invalid OTP');
      }
    } catch (err) {
      setError(err.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  // Handle reset password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!newPassword) {
      setError('Please enter new password');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.resetPassword(email, otp, newPassword);
      if (result.success) {
        setSuccess('Password reset successfully! Redirecting to login...');
        setTimeout(() => {
          onSuccess?.(email);
          onBackToLogin?.();
        }, 2000);
      } else {
        setError(result.message || 'Failed to reset password');
      }
    } catch (err) {
      setError(err.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Password strength checker
  const checkPasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    return strength;
  };

  const getPasswordStrengthColor = (password) => {
    const strength = checkPasswordStrength(password);
    if (strength === 0) return '#e0e0e0';
    if (strength <= 2) return '#f44336';
    if (strength === 3) return '#ff9800';
    return '#4CAF50';
  };

  const getPasswordStrengthText = (password) => {
    const strength = checkPasswordStrength(password);
    if (strength === 0) return 'No password';
    if (strength <= 2) return 'Weak';
    if (strength === 3) return 'Good';
    return 'Strong';
  };

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <div className="auth-header">
          <div className="logo-circle">
            <i className="fas fa-key"></i>
          </div>
          <h1>Reset Password</h1>
          <p className="subtitle">
            {step === 1 && 'Enter your email to receive OTP'}
            {step === 2 && 'Enter OTP sent to your email'}
            {step === 3 && 'Set your new password'}
          </p>
        </div>

        {/* Progress Indicator */}
        <div className="progress-steps">
          <div className={`step ${step >= 1 ? 'active' : ''}`}>
            <div className="step-number">1</div>
            <div className="step-label">Email</div>
          </div>
          <div className="step-connector"></div>
          <div className={`step ${step >= 2 ? 'active' : ''}`}>
            <div className="step-number">2</div>
            <div className="step-label">OTP</div>
          </div>
          <div className="step-connector"></div>
          <div className={`step ${step >= 3 ? 'active' : ''}`}>
            <div className="step-number">3</div>
            <div className="step-label">Password</div>
          </div>
        </div>

        {error && (
          <div className="error-message slide-in">
            <i className="fas fa-exclamation-circle"></i>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="success-message slide-in">
            <i className="fas fa-check-circle"></i>
            <span>{success}</span>
          </div>
        )}

        {/* Step 1: Email Input */}
        {step === 1 && (
          <form onSubmit={handleSendOTP} className="auth-form">
            <div className="input-group floating-label">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder=" "
                autoFocus
              />
              <label>Registered Email Address</label>
              <i className="fas fa-envelope input-icon"></i>
            </div>

            <button 
              type="submit" 
              className="auth-button primary"
              disabled={loading || !email}
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Sending OTP...
                </>
              ) : (
                <>
                  <i className="fas fa-paper-plane"></i>
                  Send OTP
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 2: OTP Verification */}
        {step === 2 && (
          <form onSubmit={handleVerifyOTP} className="auth-form">
            <div className="otp-info">
              <i className="fas fa-envelope-open-text"></i>
              <p>
                Enter the 6-digit OTP sent to <strong>{email}</strong>
                <br />
                <small>Check your inbox and spam folder</small>
              </p>
            </div>

            <div className="otp-input-container">
              <input
                type="text"
                value={otp}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  if (value.length <= 6) {
                    setOtp(value);
                  }
                }}
                maxLength="6"
                placeholder="000000"
                className="otp-input"
                disabled={loading}
                autoFocus
              />
              <div className="otp-hint">Enter 6-digit code</div>
            </div>

            <div className="resend-otp">
              {resendTimer > 0 ? (
                <span className="timer">
                  Resend OTP in {resendTimer}s
                </span>
              ) : (
                <button 
                  type="button"
                  onClick={handleResendOTP}
                  className="resend-btn"
                  disabled={loading}
                >
                  <i className="fas fa-redo"></i>
                  Resend OTP
                </button>
              )}
            </div>

            <button 
              type="submit" 
              className="auth-button primary"
              disabled={loading || otp.length !== 6}
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Verifying...
                </>
              ) : (
                <>
                  <i className="fas fa-check-circle"></i>
                  Verify OTP
                </>
              )}
            </button>

            <button 
              type="button"
              onClick={() => {
                setStep(1);
                setError('');
                setSuccess('');
              }}
              className="auth-button secondary"
              disabled={loading}
            >
              <i className="fas fa-arrow-left"></i>
              Change Email
            </button>
          </form>
        )}

        {/* Step 3: New Password */}
        {step === 3 && (
          <form onSubmit={handleResetPassword} className="auth-form">
            <div className="otp-info">
              <i className="fas fa-shield-alt"></i>
              <p>Create a new secure password for your account</p>
            </div>

            <div className="input-group floating-label">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
                placeholder=" "
                autoFocus
              />
              <label>New Password</label>
              <i className="fas fa-lock input-icon"></i>
              {newPassword && (
                <div className="password-strength">
                  <div 
                    className="strength-bar"
                    style={{ 
                      width: `${(checkPasswordStrength(newPassword) / 4) * 100}%`,
                      backgroundColor: getPasswordStrengthColor(newPassword)
                    }}
                  ></div>
                  <span className="strength-text">
                    {getPasswordStrengthText(newPassword)}
                  </span>
                </div>
              )}
            </div>

            <div className="password-requirements">
              <h5>Password must contain:</h5>
              <ul>
                <li className={newPassword.length >= 8 ? 'valid' : ''}>
                  <i className={`fas ${newPassword.length >= 8 ? 'fa-check-circle' : 'fa-circle'}`}></i>
                  At least 8 characters
                </li>
                <li className={/[A-Z]/.test(newPassword) ? 'valid' : ''}>
                  <i className={`fas ${/[A-Z]/.test(newPassword) ? 'fa-check-circle' : 'fa-circle'}`}></i>
                  One uppercase letter
                </li>
                <li className={/[0-9]/.test(newPassword) ? 'valid' : ''}>
                  <i className={`fas ${/[0-9]/.test(newPassword) ? 'fa-check-circle' : 'fa-circle'}`}></i>
                  One number
                </li>
                <li className={/[^A-Za-z0-9]/.test(newPassword) ? 'valid' : ''}>
                  <i className={`fas ${/[^A-Za-z0-9]/.test(newPassword) ? 'fa-check-circle' : 'fa-circle'}`}></i>
                  One special character
                </li>
              </ul>
            </div>

            <div className="input-group floating-label">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                placeholder=" "
              />
              <label>Confirm New Password</label>
              <i className="fas fa-lock input-icon"></i>
              {confirmPassword && newPassword && (
                <div className="password-match">
                  <i className={`fas fa-${newPassword === confirmPassword ? 'check' : 'times'}-circle`}></i>
                  <span>{newPassword === confirmPassword ? 'Passwords match' : 'Passwords do not match'}</span>
                </div>
              )}
            </div>

            <button 
              type="submit" 
              className="auth-button primary"
              disabled={loading || !newPassword || newPassword !== confirmPassword || checkPasswordStrength(newPassword) < 2}
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Updating Password...
                </>
              ) : (
                <>
                  <i className="fas fa-key"></i>
                  Reset Password
                </>
              )}
            </button>

            <button 
              type="button"
              onClick={() => {
                setStep(2);
                setError('');
                setSuccess('');
              }}
              className="auth-button secondary"
              disabled={loading}
            >
              <i className="fas fa-arrow-left"></i>
              Back to OTP
            </button>
          </form>
        )}

        <div className="auth-footer">
          <button 
            onClick={onBackToLogin}
            className="auth-button secondary"
            disabled={loading}
          >
            <i className="fas fa-arrow-left"></i>
            Back to Login
          </button>
        </div>

        <div className="security-notice">
          <i className="fas fa-shield-alt"></i>
          <span>Your password will be securely encrypted</span>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
