import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense, memo } from 'react';
import Header from './Header';
import { productService } from '../services/authService';
import { checkExpiringProducts } from '../services/notifications';
import './Dashboard.css';

const Scanner     = lazy(() => import('./Scanner'));
const AddManual   = lazy(() => import('./AddManual'));
const ProductList = lazy(() => import('./ProductList'));

// Static display card — no click, no hover effect
const StatCard = memo(({ icon, label, value, colorClass }) => (
  <div className={`stat-card ${colorClass}`}>
    <div className="stat-icon"><i className={`fas ${icon}`} /></div>
    <div className="stat-body">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  </div>
));

const TabSpinner = () => (
  <div className="tab-loading">
    <div className="spinner" />
    <span>Loading…</span>
  </div>
);

const Dashboard = ({ user, onLogout }) => {
  const [activeTab,     setActiveTab]     = useState('scanner'); // scanner is default
  const [products,      setProducts]      = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);

  const stats = useMemo(() => {
    const today = new Date();
    const total       = products.length;
    const expired     = products.filter(p => new Date(p.expiryDate) < today).length;
    const expiringSoon = products.filter(p => {
      const d = Math.ceil((new Date(p.expiryDate) - today) / 86400000);
      return d >= 0 && d <= 7;
    }).length;
    const safe = Math.max(0, total - expired - expiringSoon);
    return { total, expired, expiringSoon, safe };
  }, [products]);

  useEffect(() => { setNotifications(checkExpiringProducts(products)); }, [products]);

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

  const handleProductScanned = useCallback(async (product) => {
    try {
      const result = await productService.addProduct(product);
      if (result.product) setProducts(prev => [result.product, ...prev]);
    } catch (err) { console.error('Add product error:', err); }
  }, []);

  const handleProductRemove = useCallback(async (productId) => {
    try {
      await productService.deleteProduct(productId);
      setProducts(prev => prev.filter(p => (p._id || p.id) !== productId));
    } catch (err) { console.error('Delete product error:', err); }
  }, []);

  const handleProductEdit = useCallback(async (productId, updates) => {
    try {
      const result = await productService.editProduct(productId, updates);
      const updated = result.product || result;
      setProducts(prev => prev.map(p => (p._id || p.id) === productId ? { ...p, ...updated } : p));
    } catch (err) {
      console.error('Edit product error:', err);
      throw err;
    }
  }, []);

  const switchTab = useCallback((tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  }, []);

  const navItems = [
    { id: 'scanner',  icon: 'fa-camera',    label: 'Scanner'                        },
    { id: 'manual',   icon: 'fa-pencil-alt', label: 'Add Manual'                    },
    { id: 'products', icon: 'fa-box-open',   label: `Products (${products.length})` },
  ];

  return (
    <div className={`dashboard ${sidebarOpen ? 'sidebar-open' : ''}`}>

      <Header
        user={user}
        onLogout={onLogout}
        notifications={notifications}
        onMenuClick={() => setSidebarOpen(o => !o)}
      />

      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />

      {/* Sidebar — scanner active by default; logout only here */}
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

      {/* Main — stats only, no tab strip below cards */}
      <main className="dash-main">
        <div className="stats-row">
          <StatCard icon="fa-boxes"               label="Total"    value={stats.total}        colorClass="stat-neutral" />
          <StatCard icon="fa-check-circle"         label="Safe"     value={stats.safe}         colorClass="stat-safe"    />
          <StatCard icon="fa-exclamation-triangle" label="Expiring" value={stats.expiringSoon} colorClass="stat-warn"    />
          <StatCard icon="fa-times-circle"         label="Expired"  value={stats.expired}      colorClass="stat-danger"  />
        </div>

        {/* No tab strip here — navigation is sidebar only */}
        <div className="tab-content">
          <Suspense fallback={<TabSpinner />}>
            {activeTab === 'scanner'  && <Scanner   onProductScanned={handleProductScanned} />}
            {activeTab === 'manual'   && <AddManual onProductAdded={handleProductScanned} />}
            {activeTab === 'products' && (
              <ProductList
                products={products}
                onRemoveProduct={handleProductRemove}
                onEditProduct={handleProductEdit}
                loading={loading}
              />
            )}
          </Suspense>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
