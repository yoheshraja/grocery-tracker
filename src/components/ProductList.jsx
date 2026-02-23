import React, { useState, useMemo, useCallback } from 'react';
import { format, differenceInDays } from 'date-fns';
import EditProductModal from './EditProductModal';
import './ProductList.css';

// ── Helpers ───────────────────────────────────────
const getExpiryInfo = (expiryDate) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiryDate); exp.setHours(0,0,0,0);
  const days  = differenceInDays(exp, today);
  if (days < 0)  return { status:'expired',       label:`Expired ${Math.abs(days)}d ago`, color:'#c62828', bg:'#ffebee', border:'#ef9a9a', dot:'#e53935' };
  if (days === 0) return { status:'expired',       label:'Expires today!',                color:'#c62828', bg:'#ffebee', border:'#ef9a9a', dot:'#e53935' };
  if (days <= 3)  return { status:'expiring-soon', label:`${days} day${days===1?'':'s'} left`, color:'#bf360c', bg:'#fbe9e7', border:'#ffab91', dot:'#e64a19' };
  if (days <= 7)  return { status:'expiring-soon', label:`${days} days left`,            color:'#e65100', bg:'#fff3e0', border:'#ffcc80', dot:'#fb8c00' };
  return          { status:'safe',                 label:`${days} days left`,             color:'#2e7d32', bg:'#e8f5e9', border:'#a5d6a7', dot:'#43a047' };
};

const getCategoryEmoji = (cat='') => {
  const m = { dairy:'🥛', fruits:'🍎', vegetables:'🥦', 'meat & seafood':'🥩', bakery:'🍞', snacks:'🍪', beverages:'🥤', 'canned goods':'🥫', 'frozen foods':'🧊', condiments:'🧴', 'personal care':'🧼', other:'📦' };
  return m[cat.toLowerCase()] || '📦';
};

const STATUS_FILTERS = [
  { value:'all',           label:'All',          icon:'fa-th-list'        },
  { value:'expired',       label:'Expired',      icon:'fa-times-circle'   },
  { value:'expiring-soon', label:'Expiring Soon',icon:'fa-clock'          },
  { value:'safe',          label:'Safe',         icon:'fa-check-circle'   },
];

// ── Product Card ──────────────────────────────────
const ProductCard = ({ product, onEdit, onRemove }) => {
  const [removing, setRemoving] = useState(false);
  const exp   = getExpiryInfo(product.expiryDate);
  const emoji = (product.image && !product.image.startsWith('http'))
    ? product.image : getCategoryEmoji(product.category);

  const handleRemove = async () => {
    if (!window.confirm(`Remove "${product.name}" from your inventory?`)) return;
    setRemoving(true);
    try { await onRemove(product._id || product.id); }
    catch { setRemoving(false); }
  };

  return (
    <div className="product-card" style={{ borderLeftColor: exp.border }}>
      <span className="expiry-dot" style={{ background: exp.dot }} />

      <div className="product-emoji">{emoji}</div>

      <div className="product-info">
        <h4 className="product-name">{product.name}</h4>
        <div className="product-meta">
          {product.brand && product.brand !== 'Unknown' && product.brand !== '' && (
            <span className="meta-pill"><i className="fas fa-building"></i>{product.brand}</span>
          )}
          <span className="meta-pill"><i className="fas fa-folder"></i>{product.category}</span>
          {product.quantity && (
            <span className="meta-pill"><i className="fas fa-weight"></i>{product.quantity}</span>
          )}
        </div>
        <div className="product-date-row">
          <i className="fas fa-calendar-alt"></i>
          <span>{product.expiryDate ? format(new Date(product.expiryDate),'dd MMM yyyy') : '—'}</span>
        </div>
      </div>

      <div className="product-right">
        <span className="expiry-badge" style={{ background:exp.bg, color:exp.color, borderColor:exp.border }}>
          {exp.status === 'expired' ? <i className="fas fa-times-circle"></i>
            : exp.status === 'expiring-soon' ? <i className="fas fa-clock"></i>
            : <i className="fas fa-check-circle"></i>}
          {exp.label}
        </span>

        <div className="product-actions">
          {/* ✏️ Edit — icon + text so it's unmistakable */}
          <button className="action-btn btn-edit" onClick={() => onEdit(product)} title="Edit product">
            <i className="fas fa-pencil-alt"></i>
            <span>Edit</span>
          </button>
          {/* 🗑️ Delete — icon + text */}
          <button className="action-btn btn-delete" onClick={handleRemove} disabled={removing} title="Delete product">
            {removing
              ? <><i className="fas fa-spinner fa-spin"></i><span>…</span></>
              : <><i className="fas fa-trash-alt"></i><span>Delete</span></>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Product List ──────────────────────────────────
const ProductList = ({ products, categories, onRemoveProduct, onEditProduct, loading }) => {
  const [search,         setSearch]         = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [editingProduct, setEditingProduct] = useState(null);
  const [sortBy,         setSortBy]         = useState('expiry-asc');

  const filtered = useMemo(() => {
    let list = [...products];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.brand||'').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'all') list = list.filter(p => p.category === categoryFilter);
    if (statusFilter   !== 'all') list = list.filter(p => getExpiryInfo(p.expiryDate).status === statusFilter);
    list.sort((a,b) => {
      if (sortBy==='expiry-asc')  return new Date(a.expiryDate) - new Date(b.expiryDate);
      if (sortBy==='expiry-desc') return new Date(b.expiryDate) - new Date(a.expiryDate);
      if (sortBy==='name-asc')    return a.name.localeCompare(b.name);
      if (sortBy==='added-new')   return new Date(b.scanDate||b.createdAt) - new Date(a.scanDate||a.createdAt);
      return 0;
    });
    return list;
  }, [products, search, categoryFilter, statusFilter, sortBy]);

  const counts = useMemo(() => ({
    all:     products.length,
    expired: products.filter(p => getExpiryInfo(p.expiryDate).status==='expired').length,
    soon:    products.filter(p => getExpiryInfo(p.expiryDate).status==='expiring-soon').length,
    safe:    products.filter(p => getExpiryInfo(p.expiryDate).status==='safe').length,
  }), [products]);

  const handleSaveEdit = useCallback(async (productId, updates) => {
    await onEditProduct(productId, updates);
  }, [onEditProduct]);

  const clearFilters = () => { setSearch(''); setCategoryFilter('all'); setStatusFilter('all'); };
  const hasFilters   = search || categoryFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="product-list-container">
      {/* Header */}
      <div className="pl-header">
        <div>
          <h2><i className="fas fa-boxes"></i> My Groceries</h2>
          <p>Manage all your grocery expiry dates</p>
        </div>
        <div className="pl-count-pills">
          <span className="count-pill safe">{counts.safe} Safe</span>
          <span className="count-pill soon">{counts.soon} Soon</span>
          <span className="count-pill expired">{counts.expired} Expired</span>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="pl-search-row">
        <div className="search-box">
          <i className="fas fa-search search-icon"></i>
          <input
            type="text"
            placeholder="Search by name, brand or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>
              <i className="fas fa-times"></i>
            </button>
          )}
        </div>
        <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="expiry-asc">Expiry: Soonest</option>
          <option value="expiry-desc">Expiry: Latest</option>
          <option value="name-asc">Name: A→Z</option>
          <option value="added-new">Recently Added</option>
        </select>
      </div>

      {/* Status tabs */}
      <div className="status-tabs">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            className={`status-tab ${statusFilter===f.value?'active':''} tab-${f.value}`}
            onClick={() => setStatusFilter(f.value)}
          >
            <i className={`fas ${f.icon}`}></i>
            {f.label}
            <span className="tab-count">
              {f.value==='all' ? counts.all : f.value==='expired' ? counts.expired : f.value==='expiring-soon' ? counts.soon : counts.safe}
            </span>
          </button>
        ))}
      </div>

      {/* Category chips from backend */}
      <div className="category-filter-row">
        <button className={`cat-chip ${categoryFilter==='all'?'active':''}`} onClick={() => setCategoryFilter('all')}>
          All Categories
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            className={`cat-chip ${categoryFilter===cat?'active':''}`}
            onClick={() => setCategoryFilter(cat)}
          >
            {getCategoryEmoji(cat)} {cat}
          </button>
        ))}
      </div>

      {/* Filter notice */}
      {hasFilters && (
        <div className="filter-notice">
          <i className="fas fa-filter"></i>
          Showing <strong>{filtered.length}</strong> of {products.length} items
          <button className="clear-filters-btn" onClick={clearFilters}>
            <i className="fas fa-times"></i> Clear
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="pl-loading">
          {[...Array(4)].map((_,i) => <div key={i} className="product-skeleton" style={{animationDelay:`${i*.1}s`}} />)}
        </div>
      ) : products.length === 0 ? (
        <div className="pl-empty">
          <i className="fas fa-shopping-basket"></i>
          <h3>No Groceries Yet</h3>
          <p>Use the Scanner or Add Manually to start tracking.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="pl-empty">
          <i className="fas fa-search"></i>
          <h3>No Items Found</h3>
          <p>Try adjusting your search or filters.</p>
          <button className="btn-retry" onClick={clearFilters}>Clear Filters</button>
        </div>
      ) : (
        <div className="product-cards">
          {filtered.map((product, i) => (
            <ProductCard
              key={product._id || product.id || i}
              product={product}
              onEdit={setEditingProduct}
              onRemove={onRemoveProduct}
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          categories={categories}
          onSave={handleSaveEdit}
          onClose={() => setEditingProduct(null)}
        />
      )}
    </div>
  );
};

export default ProductList;