import React, { memo } from 'react';
import { useTheme } from '../context/ThemeContext';
import './Header.css';

const Header = memo(({ user, onLogout, notifications = [], onMenuClick }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="app-header">
      <div className="app-header-inner">

        {/* Left */}
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

        {/* Right — logout removed; username always visible */}
        <div className="header-right">
          <button className="theme-toggle header-theme-btn" onClick={toggleTheme} title="Toggle theme">
            <i className={`fas fa-${theme === 'light' ? 'moon' : 'sun'}`} />
          </button>

          {user && (
            <>
              {/* User pill — name always shown, bell/notifications removed */}
              <div className="user-pill">
                <div className="user-avatar-sm">
                  {user.name?.charAt(0).toUpperCase()}
                </div>
                <span className="user-pill-name">{user.name?.split(' ')[0]}</span>
              </div>
              {/* No logout button here — it lives in the sidebar */}
            </>
          )}
        </div>

      </div>
    </header>
  );
});

export default Header;
