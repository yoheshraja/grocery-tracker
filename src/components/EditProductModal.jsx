import React, { useState, useEffect } from 'react';
import './EditProductModal.css';

const EditProductModal = ({ product, categories, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    name: product.name || '',
    category: product.category || 'Other',
    brand: product.brand || '',
    expiryDate: product.expiryDate ? new Date(product.expiryDate).toISOString().split('T')[0] : '',
    quantity: product.quantity || '',
    notes: product.notes || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Product name is required'); return; }
    if (!formData.expiryDate) { setError('Expiry date is required'); return; }

    setLoading(true);
    try {
      await onSave(product._id || product.id, formData);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="edit-modal">
        {/* Header */}
        <div className="edit-modal-header">
          <div className="edit-modal-title">
            <div className="edit-modal-icon">
              <i className="fas fa-pencil-alt"></i>
            </div>
            <div>
              <h3>Edit Product</h3>
              <p>Update product details</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} disabled={loading}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="edit-modal-body">
          {error && (
            <div className="edit-error">
              <i className="fas fa-exclamation-circle"></i>
              {error}
            </div>
          )}

          <div className="edit-form-grid">
            <div className="edit-form-group full-width">
              <label htmlFor="edit-name">
                <i className="fas fa-tag"></i> Product Name *
              </label>
              <input
                id="edit-name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleChange}
                placeholder="Product name"
                disabled={loading}
                required
              />
            </div>

            <div className="edit-form-group">
              <label htmlFor="edit-category">
                <i className="fas fa-folder"></i> Category
              </label>
              <select
                id="edit-category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                disabled={loading}
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="edit-form-group">
              <label htmlFor="edit-brand">
                <i className="fas fa-building"></i> Brand
              </label>
              <input
                id="edit-brand"
                name="brand"
                type="text"
                value={formData.brand}
                onChange={handleChange}
                placeholder="Brand name"
                disabled={loading}
              />
            </div>

            <div className="edit-form-group">
              <label htmlFor="edit-expiry">
                <i className="fas fa-calendar-alt"></i> Expiry Date *
              </label>
              <input
                id="edit-expiry"
                name="expiryDate"
                type="date"
                value={formData.expiryDate}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>

            <div className="edit-form-group">
              <label htmlFor="edit-quantity">
                <i className="fas fa-weight"></i> Quantity / Size
              </label>
              <input
                id="edit-quantity"
                name="quantity"
                type="text"
                value={formData.quantity}
                onChange={handleChange}
                placeholder="e.g. 500g, 1L"
                disabled={loading}
              />
            </div>

            <div className="edit-form-group full-width">
              <label htmlFor="edit-notes">
                <i className="fas fa-sticky-note"></i> Notes
              </label>
              <textarea
                id="edit-notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Optional notes..."
                disabled={loading}
                rows={2}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="edit-modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-save" disabled={loading}>
              {loading
                ? <><i className="fas fa-spinner fa-spin"></i> Saving…</>
                : <><i className="fas fa-check"></i> Save Changes</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditProductModal;
