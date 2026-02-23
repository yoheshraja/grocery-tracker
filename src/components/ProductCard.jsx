import React from 'react';
import { format, differenceInDays, isAfter } from 'date-fns';

const ProductCard = ({ product, onRemove }) => {
  const today = new Date();
  const expiryDate = new Date(product.expiryDate);
  const daysLeft = differenceInDays(expiryDate, today);
  const isExpired = isAfter(today, expiryDate);

  const status = isExpired
    ? { key: 'expired', label: 'Expired', cls: 'danger', icon: 'fa-times-circle' }
    : daysLeft <= 3
    ? { key: 'expiring', label: `${daysLeft}d left`, cls: 'warning', icon: 'fa-exclamation-circle' }
    : daysLeft <= 7
    ? { key: 'expiring', label: `${daysLeft} days left`, cls: 'warning', icon: 'fa-clock' }
    : { key: 'fresh', label: `${daysLeft} days left`, cls: 'fresh', icon: 'fa-check-circle' };

  return (
    <div className={`product-card ${status.key}`}>
      <div className="product-header">
        <div className="product-name">
          {typeof product.image === 'string' && product.image.startsWith('http') ? (
            <img src={product.image} alt="" style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4, marginRight: 6 }} />
          ) : (
            <span style={{ marginRight: 6 }}>{product.image || '📦'}</span>
          )}
          {product.name}
        </div>
        <span className="product-category">{product.category}</span>
      </div>

      <div className="product-details">
        <div className={`expiry-date ${status.cls === 'warning' || status.cls === 'danger' ? status.cls : ''}`}>
          <i className="fas fa-calendar-alt"></i>
          <span>{format(expiryDate, 'MMM dd, yyyy')}</span>
        </div>
        <div className={`expiry-date ${status.cls === 'warning' ? 'warning' : status.cls === 'danger' ? 'danger' : ''}`}>
          <i className={`fas ${status.icon}`}></i>
          <span style={{ fontWeight: 600 }}>{status.label}</span>
        </div>
        {product.brand && product.brand !== 'Unknown' && (
          <div className="expiry-date">
            <i className="fas fa-building"></i>
            <span>{product.brand}</span>
          </div>
        )}
        {product.barcode && (
          <div className="expiry-date">
            <i className="fas fa-barcode"></i>
            <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '.8rem' }}>{product.barcode}</span>
          </div>
        )}
      </div>

      <button className="delete-btn" onClick={() => onRemove(product._id || product.id)}>
        <i className="fas fa-trash-alt"></i> Remove
      </button>
    </div>
  );
};

export default ProductCard;