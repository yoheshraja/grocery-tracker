import React, { useState, useEffect, useCallback } from 'react';
import { productService } from '../services/authService';
import { format, differenceInDays } from 'date-fns';
import './Recentlyadded.css';

const getCategoryEmoji = (cat = '') => {
  const map = {
    'dairy': '🥛', 'fruits': '🍎', 'vegetables': '🥦', 'meat': '🥩',
    'bakery': '🍞', 'snacks': '🍪', 'beverages': '🥤', 'canned': '🥫',
    'frozen': '🧊', 'condiments': '🧴', 'personal': '🧼', 'other': '📦'
  };
  const lower = cat.toLowerCase();
  for (const [key, emoji] of Object.entries(map)) {
    if (lower.includes(key)) return emoji;
  }
  return '📦';
};

const ExpiryChip = ({ expiryDate }) => {
  const today = new Date();
  const exp = new Date(expiryDate);
  const days = differenceInDays(exp, today);
  const isExpired = exp < today;

  let cls = 'chip-safe';
  let label = `${days}d left`;
  let icon = 'fa-check-circle';

  if (isExpired) {
    cls = 'chip-expired'; label = 'Expired'; icon = 'fa-times-circle';
  } else if (days <= 3) {
    cls = 'chip-urgent'; label = `${days}d left`; icon = 'fa-exclamation-circle';
  } else if (days <= 7) {
    cls = 'chip-warning'; label = `${days}d left`; icon = 'fa-clock';
  }

  return (
    <span className={`expiry-chip ${cls}`}>
      <i className={`fas ${icon}`}></i>
      {label}
    </span>
  );
};

const RecentlyAdded = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await productService.getRecentProducts();
      setItems(Array.isArray(data) ? data : []);
      setLastRefresh(new Date());
    } catch (err) {
      setError('Failed to load recent items. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="recent-container">
      {/* Header */}
      <div className="recent-header">
        <div>
          <h2><i className="fas fa-history"></i> Recently Added</h2>
          <p>Last 20 items added to your inventory, most recent first</p>
        </div>
        <div className="recent-header-actions">
          {lastRefresh && (
            <span className="last-refresh">
              <i className="fas fa-clock"></i>
              Updated {format(lastRefresh, 'h:mm a')}
            </span>
          )}
          <button className="refresh-btn" onClick={load} disabled={loading}>
            <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i>
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="recent-loading">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      ) : error ? (
        <div className="recent-error">
          <i className="fas fa-exclamation-triangle"></i>
          <p>{error}</p>
          <button onClick={load} className="btn-retry">Try Again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="recent-empty">
          <i className="fas fa-box-open"></i>
          <h3>No Items Yet</h3>
          <p>Start scanning or adding products and they'll appear here.</p>
        </div>
      ) : (
        <div className="recent-list">
          {items.map((item, idx) => {
            const emoji = typeof item.image === 'string' && !item.image.startsWith('http')
              ? item.image : getCategoryEmoji(item.category);
            return (
              <div key={item._id || idx} className="recent-item" style={{ animationDelay: `${idx * 0.04}s` }}>
                <div className="recent-item-rank">{idx + 1}</div>
                <div className="recent-item-emoji">{emoji}</div>
                <div className="recent-item-info">
                  <span className="recent-item-name">{item.name}</span>
                  <span className="recent-item-meta">
                    <span className="meta-cat">
                      <i className="fas fa-folder"></i> {item.category}
                    </span>
                    {item.brand && item.brand !== 'Unknown' && (
                      <span className="meta-brand">
                        <i className="fas fa-building"></i> {item.brand}
                      </span>
                    )}
                    <span className="meta-added">
                      <i className="fas fa-plus-circle"></i>
                      Added {item.scanDate ? format(new Date(item.scanDate), 'MMM d, yyyy') : '—'}
                    </span>
                  </span>
                </div>
                <div className="recent-item-right">
                  <ExpiryChip expiryDate={item.expiryDate} />
                  <span className="recent-item-date">
                    {item.expiryDate ? format(new Date(item.expiryDate), 'dd MMM yyyy') : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer count */}
      {!loading && !error && items.length > 0 && (
        <div className="recent-footer">
          <i className="fas fa-info-circle"></i>
          Showing {items.length} most recently added item{items.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default RecentlyAdded;
