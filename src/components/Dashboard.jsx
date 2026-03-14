import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense, memo } from 'react';
import Header from './Header';
import { productService } from '../services/authService';
import { checkExpiringProducts } from '../services/notifications';
import './Dashboard.css';


// ── Lazy-loaded tabs (code splitting) ────────────────────────────────────────
const Scanner    = lazy(() => import('./Scanner'));
const AddManual  = lazy(() => import('./AddManual'));
const ProductList = lazy(() => import('./ProductList'));

// ── Stats Card ────────────────────────────────────────────────────────────────
const StatCard = memo(({ icon, label, value, colorClass, onClick }) => (
  <button className={`stat-card ${colorClass}`} onClick={onClick}>
    <div className="stat-icon"><i className={`fas ${icon}`} /></div>
    <div className="stat-body">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  </button>
));

// ── Tab Spinner ───────────────────────────────────────────────────────────────
const TabSpinner = () => (
  <div className="tab-loading">
    <div className="spinner" />
    <span>Loading…</span>
  </div>
);

// ── Dashboard ─────────────────────────────────────────────────────────────────
const Dashboard = ({ user, onLogout }) => {
  const [activeTab,    setActiveTab]    = useState('scanner');
  const [products,     setProducts]     = useState([]);
  const [notifications,setNotifications]= useState([]);
  const [loading,      setLoading]      = useState(true);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);

  // ── Stats (memoised, recalculates only when products change) ────────────
  const stats = useMemo(() => {
    const today = new Date();
    const total = products.length;
    const expired = products.filter(p => new Date(p.expiryDate) < today).length;
    const expiringSoon = products.filter(p => {
      const d = Math.ceil((new Date(p.expiryDate) - today) / 86400000);
      return d >= 0 && d <= 7;
    }).length;
    const safe = total - expired - expiringSoon;
    return { total, expired, expiringSoon, safe: safe > 0 ? safe : 0 };
  }, [products]);

  // ── Notifications (UI-only) ──────────────────────────────────────────────
  useEffect(() => {
    setNotifications(checkExpiringProducts(products));
  }, [products]);

  // ── Load products once ───────────────────────────────────────────────────
  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const result = await productService.getProducts();
      if (Array.isArray(result)) setProducts(result);
    } catch (err) {
      console.error('Load products error:', err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // ── Handlers (stable references) ────────────────────────────────────────
  const handleProductScanned = useCallback(async (product) => {
    try {
      const result = await productService.addProduct(product);
      if (result.product) setProducts(prev => [result.product, ...prev]);
    } catch (err) {
      console.error('Add product error:', err);
    }
  }, []);

  const handleProductRemove = useCallback(async (productId) => {
    try {
      await productService.deleteProduct(productId);
      setProducts(prev => prev.filter(p => (p._id || p.id) !== productId));
    } catch (err) {
      console.error('Delete product error:', err);
    }
  }, []);

  const switchTab = useCallback((tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  }, []);

  const navItems = [
    { id: 'scanner',  icon: 'fa-camera',          label: 'Scanner'        },
    { id: 'manual',   icon: 'fa-pencil-alt',       label: 'Add Manual'     },
    { id: 'products', icon: 'fa-box-open',         label: `Products (${products.length})` },
  ];

  return (
    <div className={`dashboard ${sidebarOpen ? 'sidebar-open' : ''}`}>

      <Header
        user={user}
        onLogout={onLogout}
        notifications={notifications}
        onMenuClick={() => setSidebarOpen(o => !o)}
      />

      {/* Overlay */}
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-profile">
          <div className="sidebar-avatar">{user.name?.charAt(0).toUpperCase()}</div>
          <div className="sidebar-user-info">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <i className="fas fa-times" />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`sidebar-nav-btn ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => switchTab(item.id)}
            >
              <i className={`fas ${item.icon}`} />
              <span>{item.label}</span>
              {activeTab === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-nav-btn logout-nav-btn" onClick={onLogout}>
            <i className="fas fa-sign-out-alt" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="dash-main">

        {/* Stats row */}
        <div className="stats-row">
          <StatCard icon="fa-boxes"               label="Total"         value={stats.total}       colorClass="stat-neutral" onClick={() => switchTab('products')} />
          <StatCard icon="fa-check-circle"         label="Safe"          value={stats.safe}        colorClass="stat-safe"    onClick={() => switchTab('products')} />
          <StatCard icon="fa-exclamation-triangle" label="Expiring Soon" value={stats.expiringSoon} colorClass="stat-warn"   onClick={() => switchTab('products')} />
          <StatCard icon="fa-times-circle"         label="Expired"       value={stats.expired}     colorClass="stat-danger"  onClick={() => switchTab('products')} />
        </div>

        {/* Tab strip */}
        <div className="tab-strip">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`tab-btn ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => switchTab(item.id)}
            >
              <i className={`fas ${item.icon}`} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="tab-content">
          <Suspense fallback={<TabSpinner />}>
            {activeTab === 'scanner'  && <Scanner    onProductScanned={handleProductScanned} />}
            {activeTab === 'manual'   && <AddManual  onProductAdded={handleProductScanned} />}
            {activeTab === 'products' && <ProductList products={products} onRemoveProduct={handleProductRemove} loading={loading} />}
          </Suspense>
        </div>

      </main>
    </div>
  );
};

export default Dashboard;
