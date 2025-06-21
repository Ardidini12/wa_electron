import { useState, useEffect } from 'react';
import './App.css';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import Dashboard from './components/Dashboard';

import ThemeProvider from './components/ThemeProvider';

interface User {
  username: string;
  name: string;
  createdAt: Date;
  lastLogin?: Date;
}

type AppView = 'login' | 'register' | 'dashboard' | 'loading';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('loading');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initializeApp();
    setupAutoLogin();
  }, []);

  const initializeApp = async () => {
    try {
      // Check if user is already logged in (remember me with auto-login)
      const storedUser = await window.electron.auth.getStoredUser();
      
      if (storedUser) {
        console.log('[App] Auto-login successful for user:', storedUser.username);
        setCurrentUser(storedUser);
        setCurrentView('dashboard');
      } else {
        console.log('[App] No stored user found, showing login');
        setCurrentView('login');
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
      setCurrentView('login');
    } finally {
      setIsLoading(false);
    }
  };

  const setupAutoLogin = () => {
    window.electron.app.onAutoLogin(() => {
      initializeApp();
    });
  };

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setCurrentView('dashboard');
  };

  const handleLogout = async () => {
    try {
      await window.electron.auth.logout();
      setCurrentUser(null);
      setCurrentView('login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const switchToRegister = () => {
    setCurrentView('register');
  };

  const switchToLogin = () => {
    setCurrentView('login');
  };

  const handleRegisterSuccess = () => {
    // After successful registration, redirect to login
    setCurrentView('login');
  };

  if (isLoading || currentView === 'loading') {
    return (
      <ThemeProvider>
        <div className="app">
          <div className="app-content loading">
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading WhatsApp Bulk Sender...</p>
            </div>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="app">
        <div className="app-content">
          {currentView === 'login' && (
            <LoginForm
              onLoginSuccess={handleLoginSuccess}
              onSwitchToRegister={switchToRegister}
            />
          )}
          
          {currentView === 'register' && (
            <RegisterForm
              onRegisterSuccess={handleRegisterSuccess}
              onSwitchToLogin={switchToLogin}
            />
          )}
          
          {currentView === 'dashboard' && currentUser && (
            <Dashboard
              user={currentUser}
              onLogout={handleLogout}
            />
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
