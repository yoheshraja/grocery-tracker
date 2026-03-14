import React, { useState, useRef, useEffect, memo } from 'react';
import { useTheme } from '../context/ThemeContext';
import './Header.css';

const Header = memo(({ user, onLogout, notifications = [], onMenuClick }) => {
  const { theme, toggleTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="app-header">
      <div className="app-header-inner">

        {/* Left: hamburger + logo */}
        <div className="header-left">
          {user && (
            <button className="hamburger-btn" onClick={onMenuClick} aria-label="Menu">
              <i className="fas fa-bars" />
            </button>
          )}
          <div className="app-logo">
            <div className="app-logo-icon"><i className="fas fa-leaf" /></div>
            <span>FreshTrack</span>
          </div>
        </div>

        {/* Right: actions */}
        <div className="header-right">

          {/* Theme toggle */}
          <button className="theme-toggle header-theme-btn" onClick={toggleTheme} title="Toggle theme">
            <i className={`fas fa-${theme === 'light' ? 'moon' : 'sun'}`} />
          </button>

          {user && (
            <>
              {/* Notification bell */}
              <div className="notif-wrap" ref={notifRef}>
                <button
                  className={`notif-btn ${notifications.length > 0 ? 'has-notif' : ''}`}
                  onClick={() => setNotifOpen(o => !o)}
                  aria-label="Notifications"
                >
                  <i className="fas fa-bell" />
                  {notifications.length > 0 && (
                    <span className="notif-count">{notifications.length}</span>
                  )}
                </button>

                {notifOpen && (
                  <div className="notif-dropdown card">
                    <div className="notif-dropdown-header">
                      <span>Expiry Alerts</span>
                      <button className="notif-close" onClick={() => setNotifOpen(false)}>
                        <i className="fas fa-times" />
                      </button>
                    </div>
                    {notifications.length === 0 ? (
                      <div className="notif-empty">
                        <i className="fas fa-check-circle" />
                        <span>All good! Nothing expiring soon.</span>
                      </div>
                    ) : (
                      <ul className="notif-list">
                        {notifications.map(p => {
                          const days = Math.ceil((new Date(p.expiryDate) - new Date()) / 86400000);
                          const cls  = days <= 1 ? 'danger' : days <= 3 ? 'warn' : 'safe';
                          return (
                            <li key={p._id || p.id} className={`notif-item notif-item--${cls}`}>
                              <div className="notif-dot" />
                              <div>
                                <strong>{p.name}</strong>
                                <span>{days <= 0 ? 'Expired!' : `${days} day${days > 1 ? 's' : ''} left`}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* User pill */}
              <div className="user-pill">
                <div className="user-avatar-sm">
                  {user.name?.charAt(0).toUpperCase()}
                </div>
                <span className="user-pill-name">{user.name?.split(' ')[0]}</span>
              </div>

              <button className="btn btn-ghost header-logout" onClick={onLogout}>
                <i className="fas fa-sign-out-alt" />
                <span className="logout-label">Logout</span>
              </button>
            </>
          )}
        </div>

      </div>
    </header>
  );
});

export default Header;