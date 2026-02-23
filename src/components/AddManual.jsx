import React, { useState } from 'react';
import './Addmanual.css';

const getCategoryEmoji = (cat = '') => {
  const m = {
    dairy: '🥛', fruits: '🍎', vegetables: '🥦', 'meat & seafood': '🥩',
    bakery: '🍞', snacks: '🍪', beverages: '🥤', 'canned goods': '🥫',
    'frozen foods': '🧊', condiments: '🧴', 'personal care': '🧼', other: '📦'
  };
  return m[cat.toLowerCase()] || '📦';
};

const DEFAULT_CATEGORIES = [
  'Dairy', 'Fruits', 'Vegetables', 'Meat & Seafood',
  'Bakery', 'Snacks', 'Beverages', 'Canned Goods',
  'Frozen Foods', 'Condiments', 'Personal Care', 'Other'
];

const AddManual = ({ onProductAdded, categories = DEFAULT_CATEGORIES }) => {
  const [form, setForm] = useState({
    name: '', category: 'Other', brand: '',
    expiryDate: '', quantity: '', barcode: ''
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const today = new Date().toISOString().split('T')[0];

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
    setSuccess(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) { setError('Product name is required'); return; }
    if (!form.expiryDate)  { setError('Expiry date is required'); return; }

    setLoading(true);
    setError('');

    try {
      await onProductAdded({
        name: form.name.trim(),
        category: form.category,
        brand: form.brand.trim() || 'Unknown',
        expiryDate: form.expiryDate,
        quantity: form.quantity.trim(),
        barcode: form.barcode.trim() || `MANUAL-${Date.now()}`,
        image: getCategoryEmoji(form.category),
        scanDate: new Date().toISOString()
      });

      setSuccess(true);
      setForm({ name: '', category: 'Other', brand: '', expiryDate: '', quantity: '', barcode: '' });

      setTimeout(() => setSuccess(false), 3500);
    } catch (err) {
      setError(err.message || 'Failed to add product. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-manual-container">
      {/* Header */}
      <div className="am-header">
        <div className="am-header-icon">
          <i className="fas fa-pencil-alt"></i>
        </div>
        <div>
          <h2>Add Manually</h2>
          <p>Enter product details by hand</p>
        </div>
      </div>

      {/* Success banner */}
      {success && (
        <div className="am-success">
          <i className="fas fa-check-circle"></i>
          <div>
            <strong>Product added!</strong>
            <span> You'll receive expiry alerts 7, 3, and 1 day before it expires.</span>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="am-error">
          <i className="fas fa-exclamation-circle"></i>
          {error}
        </div>
      )}

      <form className="am-form" onSubmit={handleSubmit}>
        {/* Product Name */}
        <div className="am-field full">
          <label htmlFor="am-name">
            <i className="fas fa-tag"></i> Product Name *
          </label>
          <input
            id="am-name"
            name="name"
            type="text"
            value={form.name}
            onChange={handleChange}
            placeholder="e.g. Amul Milk, Britannia Bread"
            disabled={loading}
            required
          />
        </div>

        {/* Category — from backend */}
        <div className="am-field">
          <label htmlFor="am-category">
            <i className="fas fa-folder"></i> Category *
          </label>
          <select
            id="am-category"
            name="category"
            value={form.category}
            onChange={handleChange}
            disabled={loading}
          >
            {categories.map(c => (
              <option key={c} value={c}>{getCategoryEmoji(c)} {c}</option>
            ))}
          </select>
        </div>

        {/* Expiry Date */}
        <div className="am-field">
          <label htmlFor="am-expiry">
            <i className="fas fa-calendar-alt"></i> Expiry Date *
          </label>
          <input
            id="am-expiry"
            name="expiryDate"
            type="date"
            value={form.expiryDate}
            onChange={handleChange}
            min={new Date(Date.now() - 365*86400000).toISOString().split('T')[0]}
            disabled={loading}
            required
          />
        </div>

        {/* Brand */}
        <div className="am-field">
          <label htmlFor="am-brand">
            <i className="fas fa-building"></i> Brand
          </label>
          <input
            id="am-brand"
            name="brand"
            type="text"
            value={form.brand}
            onChange={handleChange}
            placeholder="e.g. Amul, Nestle"
            disabled={loading}
          />
        </div>

        {/* Quantity */}
        <div className="am-field">
          <label htmlFor="am-quantity">
            <i className="fas fa-weight"></i> Quantity / Size
          </label>
          <input
            id="am-quantity"
            name="quantity"
            type="text"
            value={form.quantity}
            onChange={handleChange}
            placeholder="e.g. 500ml, 1kg"
            disabled={loading}
          />
        </div>

        {/* Barcode (optional) */}
        <div className="am-field">
          <label htmlFor="am-barcode">
            <i className="fas fa-barcode"></i> Barcode (optional)
          </label>
          <input
            id="am-barcode"
            name="barcode"
            type="text"
            value={form.barcode}
            onChange={handleChange}
            placeholder="Leave blank for auto-generated"
            disabled={loading}
          />
        </div>

        <div className="am-submit-row">
          <button type="submit" className="am-submit-btn" disabled={loading}>
            {loading
              ? <><i className="fas fa-spinner fa-spin"></i> Adding…</>
              : <><i className="fas fa-plus-circle"></i> Add to Inventory</>
            }
          </button>
        </div>
      </form>

      {/* Info tips */}
      <div className="am-tips">
        <div className="am-tip">
          <i className="fas fa-bell"></i>
          <span>You'll get email alerts <strong>7 days</strong>, <strong>3 days</strong>, and <strong>1 day</strong> before expiry.</span>
        </div>
        <div className="am-tip">
          <i className="fas fa-camera"></i>
          <span>Prefer scanning? Switch to <strong>Scanner</strong> to auto-fill product details.</span>
        </div>
      </div>
    </div>
  );
};

export default AddManual;