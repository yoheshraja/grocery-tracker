import React from 'react';

const Header = ({ user, onLogout, notifications = [], onMenuClick }) => {
  return (
    <header className="header">
      <div className="header-content">
        {/* Logo */}
        <div className="logo">
          {user && (
            <button className="menu-btn" onClick={onMenuClick} aria-label="Open menu">
              <i className="fas fa-bars"></i>
            </button>
          )}
          <i className="fas fa-leaf logo-icon" style={{ color: '#81c784' }}></i>
          <h1>Fresh<span>Track</span></h1>
        </div>

        {/* Actions */}
        <div className="header-actions">
          {user ? (
            <div className="user-menu">
              <div className="user-info">
                <i className="fas fa-user-circle"></i>
                <span>Hi, {user.name?.split(' ')[0]}</span>
              </div>
              {notifications.length > 0 && (
                <span className="notification-badge" title={`${notifications.length} products expiring soon`}>
                  {notifications.length}
                </span>
              )}
              <button className="logout-btn" onClick={onLogout}>
                <i className="fas fa-sign-out-alt"></i>
                Logout
              </button>
            </div>
          ) : (
            notifications.length > 0 && (
              <span className="notification-badge">{notifications.length}</span>
            )
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;