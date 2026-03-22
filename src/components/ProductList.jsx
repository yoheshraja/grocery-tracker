import React, { useState, useMemo, memo, useCallback } from 'react';
import { format, differenceInDays, isPast } from 'date-fns';
import EditProductModal from './EditProductModal';
import { productService } from '../services/authService';
import './ProductList.css';

const CATEGORIES = [
  'All','Dairy','Fruits','Vegetables','Meat & Seafood','Bakery','Snacks',
  'Beverages','Canned Goods','Frozen Foods','Condiments','Personal Care','Other',
];

const buildCalendarUrl = (productName, expiryISO) => {
  const exp = new Date(expiryISO);
  const rem = new Date(exp); rem.setDate(rem.getDate() - 1);
  const startStr = rem.toISOString().slice(0,10).replace(/-/g,'');
  const endStr   = exp.toISOString().slice(0,10).replace(/-/g,'');
  const params = new URLSearchParams({
    action:'TEMPLATE', text:`⏰ ${productName} expires tomorrow!`,
    dates:`${startStr}/${endStr}`,
    details:`FreshTrack reminder: ${productName} expires on ${exp.toLocaleDateString()}.`,
    sf:'true',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

const getStatusInfo = (expiryDate) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const days  = differenceInDays(new Date(expiryDate), today);
  const expired = isPast(new Date(expiryDate)) && days < 0;
  if (expired)   return { label:'Expired',            color:'#c62828', bg:'#ffebee', dot:'#e53935', border:'#e53935' };
  if (days === 0) return { label:'Expires today!',    color:'#c62828', bg:'#ffebee', dot:'#e53935', border:'#e53935' };
  if (days <= 3)  return { label:`${days} days left`, color:'#e65100', bg:'#fff3e0', dot:'#fb8c00', border:'#fb8c00' };
  if (days <= 7)  return { label:`${days} days left`, color:'#e65100', bg:'#fff8e1', dot:'#fbc02d', border:'#fbc02d' };
  return { label:`${days} days left`, color:'#2e7d32', bg:'#e8f5e9', dot:'#43a047', border:'#43a047' };
};

const ProductCard = memo(({ product, onRemove, onEdit, deletingId }) => {
  const info       = getStatusInfo(product.expiryDate);
  const isDeleting = deletingId === (product._id || product.id);
  const expired    = differenceInDays(new Date(product.expiryDate), new Date()) < 0;
  const daysLeft   = differenceInDays(new Date(product.expiryDate), new Date());

  return (
    <div className="pc2-card" style={{ borderLeftColor: info.border }}>

      {/* ── Header: image + name + badge ── */}
      <div className="pc2-header">
        <div className="pc2-img">
          {product.image?.startsWith('http')
            ? <img src={product.image} alt="" />
            : <span>{product.image || '📦'}</span>}
        </div>
        <div className="pc2-title">
          <p className="pc2-name" title={product.name}>{product.name}</p>
          <span className="pc2-badge"
            style={{ color: info.color, background: info.bg, borderColor: info.border }}>
            {expired
              ? <i className="fas fa-times-circle" />
              : daysLeft <= 3
                ? <i className="fas fa-exclamation-triangle" />
                : <i className="fas fa-clock" />}
            {info.label}
          </span>
        </div>
      </div>

      {/* ── Meta chips ── */}
      <div className="pc2-meta">
        <span className="pc2-chip">
          <i className="fas fa-tag" />{product.category}
        </span>
        {product.brand && product.brand !== 'Unknown' && (
          <span className="pc2-chip pc2-chip--brand">
            <i className="fas fa-store" />{product.brand}
          </span>
        )}
        {product.quantity && (
          <span className="pc2-chip">
            <i className="fas fa-balance-scale" />{product.quantity}
          </span>
        )}
        <span className="pc2-chip pc2-chip--date">
          <i className="fas fa-calendar-alt" />
          {format(new Date(product.expiryDate), 'd MMM yyyy')}
        </span>
      </div>

      {/* ── Actions ── */}
      <div className="pc2-actions">
        <button className="pc2-btn pc2-edit" onClick={() => onEdit(product)}>
          <i className="fas fa-pencil-alt" /> Edit
        </button>
        <button
          className="pc2-btn pc2-del"
          onClick={() => onRemove(product._id || product.id)}
          disabled={isDeleting}
        >
          {isDeleting
            ? <><i className="fas fa-spinner fa-spin" /> Removing…</>
            : <><i className="fas fa-trash" /> Remove</>}
        </button>
      </div>

    </div>
  );
});


const STATUS_TABS = [
  { id:'all',           label:'All',          icon:'fa-boxes',               cls:'tab-all'            },
  { id:'expired',       label:'Expired',       icon:'fa-times-circle',        cls:'tab-expired'        },
  { id:'expiring-soon', label:'Expiring Soon', icon:'fa-exclamation-triangle',cls:'tab-expiring-soon'  },
  { id:'safe',          label:'Safe',          icon:'fa-check-circle',        cls:'tab-safe'           },
];

const ProductList = ({ products = [], onRemoveProduct, loading }) => {
  const [search,         setSearch]         = useState('');
  const [statusTab,      setStatusTab]      = useState('all');
  const [sortBy,         setSortBy]         = useState('expiry-asc');
  const [activeCategory, setActiveCategory] = useState('All');
  const [editingProduct, setEditingProduct] = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [overrideProducts, setOverrideProducts] = useState(null);

  const displayProducts = overrideProducts !== null ? overrideProducts : products;

  const handleRemove = useCallback(async (id) => {
    setDeletingId(id);
    try {
      await onRemoveProduct(id);
      if (overrideProducts !== null) {
        setOverrideProducts(prev => prev.filter(p => (p._id || p.id) !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }, [onRemoveProduct, overrideProducts]);

  const handleEdit = useCallback((product) => setEditingProduct(product), []);

  const handleSave = useCallback(async (productId, updates) => {
    const result = await productService.editProduct(productId, updates);
    const newProduct = result.product || result;
    const source = overrideProducts !== null ? overrideProducts : products;
    setOverrideProducts(source.map(p =>
      (p._id || p.id) === productId ? { ...p, ...newProduct } : p
    ));
    setEditingProduct(null);
  }, [overrideProducts, products]);

  // Counts for tabs + pills
  const counts = useMemo(() => {
    const today = new Date();
    const expired       = displayProducts.filter(p => differenceInDays(new Date(p.expiryDate), today) < 0).length;
    const expiringSoon  = displayProducts.filter(p => { const d = differenceInDays(new Date(p.expiryDate), today); return d >= 0 && d <= 7; }).length;
    const safe          = displayProducts.filter(p => differenceInDays(new Date(p.expiryDate), today) > 7).length;
    return { all: displayProducts.length, expired, 'expiring-soon': expiringSoon, safe };
  }, [displayProducts]);

  const filtered = useMemo(() => {
    const today = new Date();
    return displayProducts
      .filter(p => {
        const days = differenceInDays(new Date(p.expiryDate), today);
        if (statusTab === 'expired'        && days >= 0)              return false;
        if (statusTab === 'expiring-soon'  && (days < 0 || days > 7)) return false;
        if (statusTab === 'safe'           && days <= 7)              return false;
        if (activeCategory !== 'All' && p.category !== activeCategory) return false;
        if (search) {
          const q = search.toLowerCase();
          return (p.name||'').toLowerCase().includes(q)
            || (p.brand||'').toLowerCase().includes(q)
            || (p.category||'').toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'expiry-asc')  return new Date(a.expiryDate) - new Date(b.expiryDate);
        if (sortBy === 'expiry-desc') return new Date(b.expiryDate) - new Date(a.expiryDate);
        if (sortBy === 'name-asc')    return (a.name||'').localeCompare(b.name||'');
        if (sortBy === 'name-desc')   return (b.name||'').localeCompare(a.name||'');
        if (sortBy === 'added-desc')  return new Date(b.scanDate||0) - new Date(a.scanDate||0);
        return 0;
      });
  }, [displayProducts, statusTab, activeCategory, search, sortBy]);

  const hasFilters = search || statusTab !== 'all' || activeCategory !== 'All';
  const clearFilters = () => { setSearch(''); setStatusTab('all'); setActiveCategory('All'); };

  if (loading) {
    return (
      <div className="product-list-container">
        <div className="pl-loading">
          {[...Array(4)].map((_, i) => <div key={i} className="product-skeleton"/>)}
        </div>
      </div>
    );
  }

  return (
    <div className="product-list-container">

      {/* Header */}
      <div className="pl-header">
        <div>
          <h2><i className="fas fa-box-open"/> My Products</h2>
          <p>{displayProducts.length} item{displayProducts.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <div className="pl-count-pills">
          <span className="count-pill safe">{counts.safe} safe</span>
          <span className="count-pill soon">{counts['expiring-soon']} expiring</span>
          <span className="count-pill expired">{counts.expired} expired</span>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="pl-search-row">
        <div className="search-box">
          <i className="fas fa-search search-icon"/>
          <input
            type="text"
            placeholder="Search by name, brand, or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>
              <i className="fas fa-times"/>
            </button>
          )}
        </div>
        <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="expiry-asc">Expiry ↑ (soonest first)</option>
          <option value="expiry-desc">Expiry ↓ (latest first)</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="added-desc">Recently Added</option>
        </select>
      </div>

      {/* Status tabs */}
      <div className="status-tabs">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.id}
            className={`status-tab ${tab.cls} ${statusTab === tab.id ? 'active' : ''}`}
            onClick={() => setStatusTab(tab.id)}
          >
            <i className={`fas ${tab.icon}`}/>
            {tab.label}
            <span className="tab-count">{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      {/* Category chips */}
      <div className="category-filter-row">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`cat-chip ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Active filter notice */}
      {hasFilters && (
        <div className="filter-notice">
          <i className="fas fa-filter"/>
          <span>
            Showing {filtered.length} of {displayProducts.length} products
            {search && ` matching "${search}"`}
            {activeCategory !== 'All' && ` in ${activeCategory}`}
          </span>
          <button className="clear-filters-btn" onClick={clearFilters}>
            <i className="fas fa-times"/> Clear
          </button>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="pl-empty">
          <i className="fas fa-box-open"/>
          <h3>
            {displayProducts.length === 0
              ? 'No products yet'
              : 'No products match your filters'}
          </h3>
          <p>
            {displayProducts.length === 0
              ? 'Scan a barcode or add a product manually to start tracking.'
              : 'Try adjusting your search or clearing the filters.'}
          </p>
          {hasFilters && (
            <button className="btn-retry" onClick={clearFilters}>Clear Filters</button>
          )}
        </div>
      ) : (
        <div className="product-cards">
          {filtered.map(product => (
            <ProductCard
              key={product._id || product.id}
              product={product}
              onRemove={handleRemove}
              onEdit={handleEdit}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          categories={CATEGORIES.filter(c => c !== 'All')}
          onSave={handleSave}
          onClose={() => setEditingProduct(null)}
        />
      )}
    </div>
  );
};

export default ProductList;
