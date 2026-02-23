import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Scanner from './Scanner';
import ProductList from './ProductList';
import AddManual from './AddManual';
import RecentlyAdded from './Recentlyadded';
import { productService } from '../services/authService';
import { checkExpiringProducts } from '../services/notifications';
import './Dashboard.css';
import '../styles/App.css';

const NAV_ITEMS = [
  { key: 'scanner',  icon: 'fa-camera',    label: 'Scanner',        badge: null },
  { key: 'products', icon: 'fa-boxes',     label: 'My Groceries',   badge: 'count' },
  { key: 'recent',   icon: 'fa-history',   label: 'Recently Added', badge: null },
  { key: 'manual',   icon: 'fa-pencil-alt',label: 'Add Manually',   badge: null },
];

const Dashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('scanner');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const total = products.length;
    const expiringSoon = products.filter(p => {
      const d = Math.ceil((new Date(p.expiryDate) - today) / 86400000);
      return d >= 0 && d <= 7;
    }).length;
    const expired = products.filter(p => new Date(p.expiryDate) < today).length;
    const safe = total - expiringSoon - expired;
    return { total, expiringSoon, expired, safe };
  }, [products]);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { setNotifications(checkExpiringProducts(products)); }, [products]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [prods, cats] = await Promise.all([
        productService.getProducts(),
        productService.getCategories()
      ]);
      setProducts(Array.isArray(prods) ? prods : []);
      setCategories(cats);
    } catch (err) {
      console.error('Load error:', err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleProductAdded = useCallback(async (product) => {
    try {
      const result = await productService.addProduct(product);
      if (result.product) setProducts(prev => [result.product, ...prev]);
    } catch (err) { console.error('Add error:', err); throw err; }
  }, []);

  const handleProductEdit = useCallback(async (productId, updates) => {
    const result = await productService.editProduct(productId, updates);
    if (result.product) {
      setProducts(prev => prev.map(p =>
        (p._id === productId || p.id === productId) ? result.product : p
      ));
    }
  }, []);

  const handleProductRemove = useCallback(async (productId) => {
    await productService.deleteProduct(productId);
    setProducts(prev => prev.filter(p => p._id !== productId && p.id !== productId));
  }, []);

  const navigateTo = (tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  return (
    <div className={`dashboard ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />

      {/* ── SIDEBAR (no separate header — sidebar IS the nav) ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <i className="fas fa-leaf brand-leaf"></i>
            <span className="brand-name">Fresh<span>Track</span></span>
          </div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="user-profile">
          <div className="user-avatar">{user.name?.charAt(0).toUpperCase()}</div>
          <div className="user-info-sidebar">
            <h3>{user.name}</h3>
            <p>{user.email}</p>
          </div>
          {notifications.length > 0 && (
            <span className="sidebar-notif-badge">{notifications.length}</span>
          )}
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              className={`nav-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => navigateTo(item.key)}
            >
              <i className={`fas ${item.icon}`}></i>
              <span>{item.label}</span>
              {item.badge === 'count' && products.length > 0 && (
                <span className="nav-badge">{products.length}</span>
              )}
            </button>
          ))}
          <div className="nav-divider" />
          <button className="nav-item nav-logout" onClick={onLogout}>
            <i className="fas fa-sign-out-alt"></i>
            <span>Logout</span>
          </button>
        </nav>

        <div className="sidebar-stats">
          <div className="sidebar-stat">
            <span className="ss-num ss-safe">{stats.safe}</span>
            <span className="ss-label">Safe</span>
          </div>
          <div className="sidebar-stat">
            <span className="ss-num ss-warn">{stats.expiringSoon}</span>
            <span className="ss-label">Soon</span>
          </div>
          <div className="sidebar-stat">
            <span className="ss-num ss-danger">{stats.expired}</span>
            <span className="ss-label">Expired</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="dashboard-main">
        {/* Mobile top bar — replaces Header.jsx entirely */}
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            <i className="fas fa-bars"></i>
          </button>
          <div className="mobile-brand">
            <i className="fas fa-leaf" style={{ color: '#81c784' }}></i>
            <span>FreshTrack</span>
          </div>
          <div className="mobile-notif-wrap">
            {notifications.length > 0 && (
              <span className="notif-dot">{notifications.length}</span>
            )}
            <i className="fas fa-bell"></i>
          </div>
        </div>

        <main className="main-content">
          <div className="stats-grid">
            <div className="stat-card clickable" onClick={() => navigateTo('products')}>
              <div className="stat-icon total"><i className="fas fa-box-open"></i></div>
              <div className="stat-info"><h4>{stats.total}</h4><p>Total Groceries</p></div>
            </div>
            <div className="stat-card clickable" onClick={() => navigateTo('products')}>
              <div className="stat-icon warning"><i className="fas fa-clock"></i></div>
              <div className="stat-info"><h4>{stats.expiringSoon}</h4><p>Expiring Soon</p></div>
            </div>
            <div className="stat-card clickable" onClick={() => navigateTo('products')}>
              <div className="stat-icon danger"><i className="fas fa-exclamation-triangle"></i></div>
              <div className="stat-info"><h4>{stats.expired}</h4><p>Expired Items</p></div>
            </div>
          </div>

          {activeTab === 'scanner' && (
            <Scanner onProductScanned={handleProductAdded} />
          )}
          {activeTab === 'products' && (
            <ProductList
              products={products}
              categories={categories}
              onRemoveProduct={handleProductRemove}
              onEditProduct={handleProductEdit}
              loading={loading}
            />
          )}
          {activeTab === 'recent' && <RecentlyAdded />}
          {activeTab === 'manual' && (
            <AddManual onProductAdded={handleProductAdded} categories={categories} />
          )}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;