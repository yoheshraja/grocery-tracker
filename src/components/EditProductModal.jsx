import React, { useState, useEffect } from 'react';

/* ─── All styles are inlined — no separate CSS file required ─────────────── */

const EditProductModal = ({ product, categories, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    name:       product.name       || '',
    category:   product.category   || 'Other',
    brand:      product.brand      || '',
    expiryDate: product.expiryDate
      ? new Date(product.expiryDate).toISOString().split('T')[0]
      : '',
    quantity:   product.quantity   || '',
    notes:      product.notes      || '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

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
    if (!formData.name.trim())  { setError('Product name is required'); return; }
    if (!formData.expiryDate)   { setError('Expiry date is required');  return; }
    setLoading(true);
    try {
      await onSave(product._id || product.id, formData);
    } catch (err) {
      setError(err.message || 'Failed to update product');
      setLoading(false);
    }
  };

  /* ── Shared input style ── */
  const inputBase = {
    width: '100%', padding: '.7rem .875rem',
    background: 'var(--bg-input)', border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)', fontSize: '.9rem',
    color: 'var(--text-primary)', fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box',
    transition: 'border-color .2s, box-shadow .2s',
  };
  const onFocus = (e) => {
    e.target.style.borderColor = 'var(--accent)';
    e.target.style.boxShadow   = '0 0 0 3px rgba(var(--accent-rgb),.12)';
    e.target.style.background  = 'var(--bg-card)';
  };
  const onBlur = (e) => {
    e.target.style.borderColor = 'var(--border)';
    e.target.style.boxShadow   = 'none';
    e.target.style.background  = 'var(--bg-input)';
  };

  /* ── Label ── */
  const Label = ({ htmlFor, icon, children }) => (
    <label htmlFor={htmlFor} style={{
      fontSize: '.83rem', fontWeight: 600, color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', gap: '.35rem', marginBottom: '.4rem',
    }}>
      <i className={`fas ${icon}`} style={{ color: 'var(--accent)', fontSize: '.78rem' }}/>
      {children}
    </label>
  );

  /* ── Field wrapper ── */
  const Field = ({ id, icon, label, fullWidth, children }) => (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column' }}>
      <Label htmlFor={id} icon={icon}>{label}</Label>
      {children}
    </div>
  );

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes em-fadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes em-slideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
        .em-close-btn:hover { border-color:var(--status-danger)!important; color:var(--status-danger)!important; }
        .em-cancel-btn:hover { border-color:var(--accent)!important; color:var(--accent)!important; }
        .em-save-btn:hover:not(:disabled) { background:var(--accent-dark)!important; transform:translateY(-1px); }
        .em-save-btn:disabled { opacity:.6; cursor:not-allowed; }
        @media(max-width:480px){ .em-grid{ grid-template-columns:1fr!important; } .em-footer{ flex-direction:column-reverse!important; } .em-footer button{ width:100%!important; justify-content:center!important; } }
      `}</style>

      {/* Overlay */}
      <div
        onClick={(e) => e.target === e.currentTarget && onClose()}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)',
          zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem', animation: 'em-fadeIn .2s ease',
        }}
      >
        {/* Modal box */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)',
          width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto',
          animation: 'em-slideUp .25s ease-out',
        }}>

          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.875rem' }}>
              <div style={{
                width: 40, height: 40,
                background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)', fontSize: '1rem', flexShrink: 0,
              }}>
                <i className="fas fa-pencil-alt"/>
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '.15rem' }}>
                  Edit Product
                </div>
                <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
                  Update product details
                </div>
              </div>
            </div>
            <button
              className="em-close-btn"
              onClick={onClose}
              disabled={loading}
              style={{
                width: 34, height: 34, background: 'none',
                border: '1.5px solid var(--border)', borderRadius: '50%',
                cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.85rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .2s', flexShrink: 0,
              }}
            >
              <i className="fas fa-times"/>
            </button>
          </div>

          {/* ── Body / Form ── */}
          <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '.625rem',
                padding: '.75rem 1rem', marginBottom: '1rem',
                background: 'var(--status-danger-bg)', color: 'var(--status-danger)',
                borderRadius: 'var(--radius-sm)', fontSize: '.875rem',
                border: '1px solid rgba(220,38,38,.2)',
              }}>
                <i className="fas fa-exclamation-circle"/>
                {error}
              </div>
            )}

            {/* 2-col grid */}
            <div className="em-grid" style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: '1rem', marginBottom: '1rem',
            }}>

              <Field id="em-name" icon="fa-tag" label="Product Name *" fullWidth>
                <input id="em-name" name="name" type="text"
                  value={formData.name} onChange={handleChange}
                  placeholder="Product name" disabled={loading} required
                  style={inputBase} onFocus={onFocus} onBlur={onBlur}/>
              </Field>

              <Field id="em-category" icon="fa-folder" label="Category">
                <select id="em-category" name="category"
                  value={formData.category} onChange={handleChange}
                  disabled={loading} style={inputBase}
                  onFocus={onFocus} onBlur={onBlur}>
                  {(categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>

              <Field id="em-brand" icon="fa-building" label="Brand">
                <input id="em-brand" name="brand" type="text"
                  value={formData.brand} onChange={handleChange}
                  placeholder="Brand name" disabled={loading}
                  style={inputBase} onFocus={onFocus} onBlur={onBlur}/>
              </Field>

              <Field id="em-expiry" icon="fa-calendar-alt" label="Expiry Date *">
                <input id="em-expiry" name="expiryDate" type="date"
                  value={formData.expiryDate} onChange={handleChange}
                  disabled={loading} required
                  style={inputBase} onFocus={onFocus} onBlur={onBlur}/>
              </Field>

              <Field id="em-quantity" icon="fa-weight" label="Quantity / Size">
                <input id="em-quantity" name="quantity" type="text"
                  value={formData.quantity} onChange={handleChange}
                  placeholder="e.g. 500g, 1L" disabled={loading}
                  style={inputBase} onFocus={onFocus} onBlur={onBlur}/>
              </Field>

              <Field id="em-notes" icon="fa-sticky-note" label="Notes" fullWidth>
                <textarea id="em-notes" name="notes" rows={2}
                  value={formData.notes} onChange={handleChange}
                  placeholder="Optional notes…" disabled={loading}
                  style={{ ...inputBase, resize: 'vertical', minHeight: 68 }}
                  onFocus={onFocus} onBlur={onBlur}/>
              </Field>

            </div>

            {/* ── Footer ── */}
            <div className="em-footer" style={{
              display: 'flex', gap: '.75rem', justifyContent: 'flex-end',
              paddingTop: '1rem', borderTop: '1px solid var(--border)',
            }}>
              <button
                type="button"
                className="em-cancel-btn"
                onClick={onClose}
                disabled={loading}
                style={{
                  padding: '.65rem 1.25rem',
                  background: 'var(--bg-card2)', border: '1.5px solid var(--border)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
                  fontFamily: 'inherit', fontSize: '.9rem', fontWeight: 600,
                  cursor: 'pointer', transition: 'all .2s',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="em-save-btn"
                disabled={loading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '.45rem',
                  padding: '.65rem 1.5rem',
                  background: 'var(--accent)', border: 'none',
                  borderRadius: 'var(--radius-md)', color: '#fff',
                  fontFamily: 'inherit', fontSize: '.9rem', fontWeight: 700,
                  cursor: 'pointer', transition: 'all .2s',
                  boxShadow: '0 3px 12px rgba(var(--accent-rgb),.35)',
                }}
              >
                {loading
                  ? <><i className="fas fa-spinner fa-spin"/> Saving…</>
                  : <><i className="fas fa-check"/> Save Changes</>
                }
              </button>
            </div>

          </form>
        </div>
      </div>
    </>
  );
};

export default EditProductModal;
