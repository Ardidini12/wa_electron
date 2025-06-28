import React, { useState, useRef, useEffect } from 'react';
import './WhatsAppStatusCard.css';

interface SessionInfo {
  name: string;
  phoneNumber: string;
  profilePicUrl?: string;
  platform: string;
  connectedAt: Date;
  sessionDuration: string;
}

type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'authenticated' | 'connected';

interface WhatsAppStatusCardProps {
  status: WhatsAppStatus;
  sessionInfo: SessionInfo | null;
  onClick: () => void;
}

const WhatsAppStatusCard: React.FC<WhatsAppStatusCardProps> = ({ 
  status, 
  sessionInfo, 
  onClick 
}) => {
  const [position, setPosition] = useState({ x: 20, y: window.innerHeight - 120 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setHasDragged(false);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle drag move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      // Mark as dragged if position changed significantly
      if (Math.abs(newX - position.x) > 5 || Math.abs(newY - position.y) > 5) {
        setHasDragged(true);
      }
      
      // Constrain to viewport
      const maxX = window.innerWidth - 280; // Card width
      const maxY = window.innerHeight - 100; // Card height
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Reset hasDragged after a short delay to prevent click
      setTimeout(() => setHasDragged(false), 100);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart]);

  // Get status color and icon
  const getStatusInfo = () => {
    switch (status) {
      case 'connected':
        return { color: '#4CAF50', icon: '🟢', text: 'Connected' };
      case 'connecting':
        return { color: '#FF9800', icon: '🟡', text: 'Connecting...' };
      case 'qr_ready':
        return { color: '#2196F3', icon: '🔵', text: 'Scan QR' };
      case 'authenticated':
        return { color: '#9C27B0', icon: '🟣', text: 'Authenticated' };
      default:
        return { color: '#F44336', icon: '🔴', text: 'Disconnected' };
    }
  };

  const statusInfo = getStatusInfo();

  const handleClick = () => {
    // Only trigger click if we haven't dragged
    if (!isDragging && !hasDragged) {
      onClick();
    }
  };

  return (
    <div
      ref={cardRef}
      className={`whatsapp-status-card ${status} ${isDragging ? 'dragging' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        borderLeftColor: statusInfo.color
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className="status-indicator" style={{ color: statusInfo.color }}>
        {statusInfo.icon}
      </div>
      
      <div className="profile-section">
        {sessionInfo?.profilePicUrl ? (
          <img 
            src={sessionInfo.profilePicUrl} 
            alt="Profile" 
            className="profile-pic"
          />
        ) : (
          <div className="profile-pic-placeholder">
            👤
          </div>
        )}
        
        <div className="profile-info">
          <div className="profile-name">
            {sessionInfo?.name || 'WhatsApp'}
          </div>
          <div className="profile-phone">
            {sessionInfo?.phoneNumber || statusInfo.text}
          </div>
        </div>
      </div>
      
      <div className="drag-handle">
        ⋮⋮
      </div>
    </div>
  );
};

export default WhatsAppStatusCard; 