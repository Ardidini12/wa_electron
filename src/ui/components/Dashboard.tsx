import React, { useState, useEffect } from 'react';
import { useTheme } from './ThemeProvider';
import './Dashboard.css';

interface User {
  username: string;
  name: string;
  createdAt: Date;
  lastLogin?: Date;
}

interface SessionInfo {
  name: string;
  phoneNumber: string;
  profilePicUrl?: string;
  platform: string;
  connectedAt: Date;
  sessionDuration: string;
}

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'authenticated' | 'connected';

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout }) => {
  const { theme, setTheme } = useTheme();
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus>('disconnected');
  const [qrString, setQrString] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [autoConnectAttempted, setAutoConnectAttempted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [liveConnectionTime, setLiveConnectionTime] = useState<string>('');

  useEffect(() => {
    const cleanup = setupWhatsAppListeners();
    // Try auto-connection only once
    if (!autoConnectAttempted && !isConnecting) {
      tryAutoConnection();
    }
    
    // Cleanup listeners on unmount
    return cleanup;
  }, [autoConnectAttempted, isConnecting]);

  // Live timer effect for connection duration
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (whatsappStatus === 'connected' && sessionInfo) {
      // Update immediately
      updateLiveConnectionTime();
      
      // Then update every second
      interval = setInterval(() => {
        updateLiveConnectionTime();
      }, 1000);
    } else {
      setLiveConnectionTime('');
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [whatsappStatus, sessionInfo]);

  const updateLiveConnectionTime = () => {
    if (!sessionInfo?.connectedAt) return;
    
    const now = new Date();
    const connectedAt = new Date(sessionInfo.connectedAt);
    const diffMs = now.getTime() - connectedAt.getTime();
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    
    let timeString = '';
    
    if (weeks > 0) {
      const remainingDays = days % 7;
      const remainingHours = hours % 24;
      if (remainingDays > 0) {
        timeString = `${weeks}w ${remainingDays}d ${remainingHours}h`;
      } else if (remainingHours > 0) {
        timeString = `${weeks}w ${remainingHours}h`;
      } else {
        timeString = `${weeks}w`;
      }
    } else if (days > 0) {
      const remainingHours = hours % 24;
      const remainingMinutes = minutes % 60;
      if (remainingHours > 0) {
        timeString = `${days}d ${remainingHours}h ${remainingMinutes}m`;
      } else if (remainingMinutes > 0) {
        timeString = `${days}d ${remainingMinutes}m`;
      } else {
        timeString = `${days}d`;
      }
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      const remainingSeconds = seconds % 60;
      if (remainingMinutes > 0) {
        timeString = `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
      } else {
        timeString = `${hours}h ${remainingSeconds}s`;
      }
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      timeString = `${minutes}m ${remainingSeconds}s`;
    } else {
      timeString = `${seconds}s`;
    }
    
    setLiveConnectionTime(timeString);
  };

  const tryAutoConnection = async () => {
    if (autoConnectAttempted || isConnecting) return;
    
    try {
      console.log('[Dashboard] Attempting auto-connection to WhatsApp...');
      setAutoConnectAttempted(true);
      setIsConnecting(true);
      setWhatsappStatus('connecting');
      const result = await window.electron.whatsapp.autoConnect();
      
      if (result) {
        console.log('[Dashboard] Auto-connection initiated successfully');
        // Status will be updated via event listeners
      } else {
        console.log('[Dashboard] Auto-connection failed - no saved session or connection failed');
        setWhatsappStatus('disconnected');
      }
    } catch (error) {
      console.error('[Dashboard] Auto-connection error:', error);
      setWhatsappStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  };

  const initializeWhatsApp = async () => {
    if (isConnecting) {
      console.log('[Dashboard] Connection already in progress, ignoring request');
      return;
    }
    
    try {
      console.log(`[Dashboard] Initializing WhatsApp for user: ${user.username}`);
      setIsConnecting(true);
      setWhatsappStatus('connecting');
      const result = await window.electron.whatsapp.initialize(user.username);
      
      if (result) {
        console.log('[Dashboard] WhatsApp initialization successful');
        // Status will be updated via event listeners
      } else {
        console.log('[Dashboard] WhatsApp initialization failed');
        setWhatsappStatus('disconnected');
      }
    } catch (error) {
      console.error('[Dashboard] WhatsApp initialization error:', error);
      setWhatsappStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  };

  const setupWhatsAppListeners = () => {
    const cleanupFunctions: Array<() => void> = [];

    const qrHandler = (qr: string) => {
      console.log('[Dashboard] QR code received - ready for scanning');
      setQrString(qr);
      setWhatsappStatus('qr_ready');
      setIsConnecting(false);
    };

    const authenticatedHandler = () => {
      console.log('[Dashboard] WhatsApp authenticated - session saved');
      setWhatsappStatus('authenticated');
      setQrString(null);
      setIsConnecting(false);
    };

    const readyHandler = (sessionInfo: SessionInfo) => {
      console.log('[Dashboard] WhatsApp ready and connected:', sessionInfo);
      setSessionInfo(sessionInfo);
      setWhatsappStatus('connected');
      setError('');
      setIsConnecting(false);
    };

    const disconnectedHandler = (reason: string) => {
      console.log(`[Dashboard] WhatsApp disconnected. Reason: ${reason}`);
      setWhatsappStatus('disconnected');
      setSessionInfo(null);
      setQrString(null);
      setError(`Disconnected: ${reason}`);
      setIsConnecting(false);
    };

    const authFailureHandler = (message: string) => {
      console.error('[Dashboard] WhatsApp authentication failed:', message);
      setWhatsappStatus('disconnected');
      setError(`Authentication failed: ${message}`);
      setQrString(null);
      setIsConnecting(false);
    };

    // Add listeners and collect cleanup functions
    cleanupFunctions.push(window.electron.whatsapp.onQR(qrHandler));
    cleanupFunctions.push(window.electron.whatsapp.onAuthenticated(authenticatedHandler));
    cleanupFunctions.push(window.electron.whatsapp.onReady(readyHandler));
    cleanupFunctions.push(window.electron.whatsapp.onDisconnected(disconnectedHandler));
    cleanupFunctions.push(window.electron.whatsapp.onAuthFailure(authFailureHandler));

    // Return cleanup function that calls all individual cleanup functions
    return () => {
      console.log('[Dashboard] Cleaning up WhatsApp listeners');
      cleanupFunctions.forEach(cleanup => cleanup());
    };
  };

  const handleWhatsAppLogout = async () => {
    try {
      console.log('[Dashboard] Logging out from WhatsApp...');
      setWhatsappStatus('disconnected');
      await window.electron.whatsapp.logout();
      setSessionInfo(null);
      setQrString(null);
      console.log('[Dashboard] WhatsApp logout completed');
    } catch (error) {
      console.error('[Dashboard] WhatsApp logout failed:', error);
      setError('Failed to logout from WhatsApp');
    }
  };

  const getStatusDisplay = () => {
    switch (whatsappStatus) {
      case 'disconnected':
        return { text: 'Disconnected', color: 'red', icon: '⚠️' };
      case 'connecting':
        return { text: 'Connecting...', color: 'orange', icon: '⏳' };
      case 'qr_ready':
        return { text: 'Scan QR Code', color: 'blue', icon: '📱' };
      case 'authenticated':
        return { text: 'Authenticated', color: 'green', icon: '✅' };
      case 'connected':
        return { text: 'Connected', color: 'green', icon: '✅' };
      default:
        return { text: 'Unknown', color: 'gray', icon: '❓' };
    }
  };

  const status = getStatusDisplay();

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="user-info">
          <div className="user-avatar">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="user-details">
            <h2>Welcome, {user.name}</h2>
            <p>@{user.username}</p>
          </div>
        </div>
        
        <div className="header-actions">
          <div className="theme-selector">
            <label>Theme:</label>
            <select 
              value={theme} 
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
          <button className="logout-button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="whatsapp-section">
          <div className="section-header">
            <h3>WhatsApp Connection</h3>
            <div className={`status-indicator ${status.color}`}>
              <span className="status-icon">{status.icon}</span>
              <span className="status-text">{status.text}</span>
            </div>
          </div>

          {error && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              {error}
            </div>
          )}

          <div className="whatsapp-content">
            {whatsappStatus === 'qr_ready' && qrString && (
              <div className="qr-section">
                <h4>Scan QR Code with WhatsApp</h4>
                <div className="qr-code-container">
                  <QRCodeDisplay qrString={qrString} />
                </div>
                <p className="qr-instructions">
                  1. Open WhatsApp on your phone<br/>
                  2. Go to Settings → Linked Devices<br/>
                  3. Tap "Link a Device"<br/>
                  4. Scan this QR code
                </p>
              </div>
            )}

            {whatsappStatus === 'connected' && sessionInfo && (
              <div className="session-info">
                <h4>Session Information</h4>
                
                {sessionInfo.profilePicUrl && (
                  <div className="session-profile">
                    <img 
                      src={sessionInfo.profilePicUrl} 
                      alt="WhatsApp Profile" 
                      className="whatsapp-profile-pic"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                )}
                
                <div className="session-details">
                  <div className="session-item">
                    <label>Name:</label>
                    <span>{sessionInfo.name}</span>
                  </div>
                  <div className="session-item">
                    <label>Phone:</label>
                    <span>+{sessionInfo.phoneNumber}</span>
                  </div>
                  <div className="session-item">
                    <label>Platform:</label>
                    <span>{sessionInfo.platform}</span>
                  </div>
                  <div className="session-item">
                    <label>Connected:</label>
                    <span>{new Date(sessionInfo.connectedAt).toLocaleString()}</span>
                  </div>
                  <div className="session-item">
                    <label>Duration:</label>
                    <span className="live-timer">{liveConnectionTime || sessionInfo.sessionDuration}</span>
                  </div>
                </div>
                
                <div className="session-actions">
                  <button 
                    className="whatsapp-logout-button"
                    onClick={handleWhatsAppLogout}
                  >
                    Logout WhatsApp
                  </button>
                </div>
              </div>
            )}

            {(whatsappStatus === 'disconnected' || whatsappStatus === 'connecting') && (
              <div className="connection-section">
                <div className="connection-status">
                  <div className="connection-prompt">
                    <p>Click to connect to WhatsApp</p>
                    <button 
                      className="connect-button"
                      onClick={initializeWhatsApp}
                    >
                      Connect WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bulk-section">
          <div className="section-header">
            <h3>Bulk Messaging</h3>
            <div className="coming-soon">Coming Soon</div>
          </div>
          <p>Bulk messaging features will be available once WhatsApp is connected.</p>
        </div>
      </div>
    </div>
  );
};

// QR Code Display Component
const QRCodeDisplay: React.FC<{ qrString: string }> = ({ qrString }) => {
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);

  useEffect(() => {
    generateQRCode();
  }, [qrString]);

  const generateQRCode = async () => {
    try {
      const dataURL = await window.electron.whatsapp.getQR();
      setQrDataURL(dataURL);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };

  if (!qrDataURL) {
    return <div className="qr-loading">Generating QR Code...</div>;
  }

  return (
    <div className="qr-code">
      <img src={qrDataURL} alt="WhatsApp QR Code" />
    </div>
  );
};

export default Dashboard; 