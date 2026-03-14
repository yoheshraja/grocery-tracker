import React, { memo } from 'react';
import { format, differenceInDays, isPast } from 'date-fns';
import './ProductCard.css';

const buildCalendarUrl = (productName, expiryISO) => {
  const exp  = new Date(expiryISO);
  const rem  = new Date(exp); rem.setDate(rem.getDate() - 1);
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

const ProductCard = memo(({ product, onRemove }) => {
  const expiryDate = new Date(product.expiryDate);
  const today      = new Date(); today.setHours(0,0,0,0);
  const days       = differenceInDays(expiryDate, today);
  const expired    = isPast(expiryDate) && days < 0;

  const status = expired          ? 'expired'
               : days <= 1        ? 'critical'
               : days <= 3        ? 'danger'
               : days <= 7        ? 'warn'
               : 'safe';

  const statusLabel = expired   ? 'Expired'
                    : days === 0 ? 'Expires today!'
                    : days === 1 ? 'Expires tomorrow'
                    : `${days} days left`;

  const badgeCls = expired || days <= 1 ? 'badge-danger'
                 : days <= 7            ? 'badge-warn'
                 : 'badge-safe';

  return (
    <div className={`pc-card card pc-card--${status}`}>
      <div className="pc-header">
        <div className="pc-img-wrap">
          {product.image?.startsWith('http')
            ? <img src={product.image} alt="" className="pc-img"/>
            : <span className="pc-emoji">{product.image || '📦'}</span>
          }
        </div>
        <div className="pc-info">
          <h4 className="pc-name">{product.name}</h4>
          <div className="pc-meta">
            {product.brand && product.brand !== 'Unknown' && <span className="pc-brand">{product.brand}</span>}
            <span className="badge badge-accent">{product.category}</span>
          </div>
        </div>
        <span className={`badge ${badgeCls} pc-days-badge`}>{statusLabel}</span>
      </div>

      <div className="pc-body">
        <div className="pc-date-row">
          <i className="fas fa-calendar-alt"/>
          <span>Expires: <strong>{format(expiryDate, 'd MMM yyyy')}</strong></span>
        </div>
        {product.barcode && !product.barcode.startsWith('manual_') && (
          <div className="pc-date-row">
            <i className="fas fa-barcode"/>
            <span className="pc-barcode">{product.barcode}</span>
          </div>
        )}
      </div>

      <div className="pc-footer">
        <a className="btn btn-secondary pc-cal-link"
          href={buildCalendarUrl(product.name, product.expiryDate)}
          target="_blank" rel="noopener noreferrer"
          title="Add to Google Calendar">
          <i className="fab fa-google"/> Calendar
        </a>
        <button className="btn btn-danger pc-del-btn"
          onClick={() => onRemove(product._id || product.id)}>
          <i className="fas fa-trash"/> Remove
        </button>
      </div>
    </div>
  );
});

export default ProductCard;