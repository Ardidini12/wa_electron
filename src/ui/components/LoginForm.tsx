import React, { useState, useEffect } from 'react';
import './AuthForms.css';

interface User {
  username: string;
  name: string;
  createdAt: Date;
  lastLogin?: Date;
}

interface LoginFormProps {
  onLoginSuccess: (user: User) => void;
  onSwitchToRegister: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess, onSwitchToRegister }) => {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    rememberMe: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSavedCredentials();
  }, []);

  const loadSavedCredentials = async () => {
    try {
      const savedCreds = await window.electron.auth.getSavedCredentials();
      if (savedCreds) {
        setFormData(prev => ({
          ...prev,
          username: savedCreds.username,
          password: savedCreds.password,
          rememberMe: savedCreds.rememberMe
        }));
      }
    } catch (error) {
      console.error('Failed to load saved credentials:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    
    // Clear error when user starts typing
    if (error) setError('');
  };

  const handleForgetMe = async () => {
    try {
      await window.electron.auth.clearSavedCredentials();
      setFormData({
        username: '',
        password: '',
        rememberMe: false
      });
    } catch (error) {
      console.error('Failed to clear saved credentials:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.username || !formData.password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await window.electron.auth.login({
        username: formData.username,
        password: formData.password,
        rememberMe: formData.rememberMe
      });

      if (result.success) {
        onLoginSuccess(result.user);
      } else {
        setError(result.message);
      }
    } catch (error) {
      setError('Login failed. Please try again.');
      console.error('Login error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-form">
        <div className="auth-header">
          <img src="/Logo-BSS.png" alt="Logo" className="auth-logo" />
          <h1>Welcome Back</h1>
          <p>Sign in to your WhatsApp Bulk Sender account</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form-content">
          <div className="form-column">
            {error && (
              <div className="auth-error">
                <span className="error-icon">⚠</span>
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="Enter your username"
                disabled={isLoading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
                disabled={isLoading}
                required
              />
            </div>
          </div>

          <div className="form-column">
            <div className="form-group checkbox-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="rememberMe"
                    checked={formData.rememberMe}
                    onChange={handleInputChange}
                    disabled={isLoading}
                  />
                  <span className="checkbox-text">Remember me</span>
                </label>
                
                {formData.username && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={handleForgetMe}
                    disabled={isLoading}
                    style={{ fontSize: '0.875rem' }}
                  >
                    Forget Me
                  </button>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="auth-button primary"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="loading-spinner small"></span>
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <button
              type="button"
              className="link-button"
              onClick={onSwitchToRegister}
              disabled={isLoading}
            >
              Create Account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginForm; 