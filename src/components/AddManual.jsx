import React, { useState, memo } from 'react';
import './AddManual.css';

const CATEGORIES = ['Dairy','Fruits','Vegetables','Meat & Seafood','Bakery','Snacks','Beverages','Canned Goods','Frozen Foods','Condiments','Personal Care','Other'];

// Validators
const validate = (data) => {
  const errors = {};
  if (!data.name.trim())          errors.name = 'Product name is required';
  else if (data.name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
  if (!data.expiryDate)           errors.expiryDate = 'Expiry date is required';
  else {
    const exp = new Date(data.expiryDate);
    const now = new Date(); now.setHours(0,0,0,0);
    if (isNaN(exp.getTime()))     errors.expiryDate = 'Invalid date';
    else if (exp < now)           errors.expiryDate = 'Expiry date cannot be in the past';
  }
  if (data.barcode && !/^[0-9A-Za-z-]{4,20}$/.test(data.barcode))
    errors.barcode = 'Barcode must be 4–20 alphanumeric characters';
  return errors;
};

// Google Calendar URL helper
const buildCalendarUrl = (productName, expiryISO) => {
  const exp  = new Date(expiryISO);
  const rem  = new Date(exp); rem.setDate(rem.getDate() - 1);
  const startStr = rem.toISOString().slice(0,10).replace(/-/g,'');
  const endStr   = exp.toISOString().slice(0,10).replace(/-/g,'');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text:   `⏰ ${productName} expires tomorrow!`,
    dates:  `${startStr}/${endStr}`,
    details:`FreshTrack reminder: ${productName} expires on ${exp.toLocaleDateString()}.`,
    sf: 'true',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

const AddManual = memo(({ onProductAdded }) => {
  const [formData, setFormData] = useState({ name:'', category:'Other', expiryDate:'', barcode:'', brand:'', quantity:'' });
  const [errors,   setErrors]   = useState({});
  const [touched,  setTouched]  = useState({});
  const [loading,  setLoading]  = useState(false);
  const [saved,    setSaved]    = useState(null);

  const today = new Date().toISOString().split('T')[0];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(d => ({ ...d, [name]: value }));
    setTouched(t => ({ ...t, [name]: true }));
    // Live validate touched field
    const newErrs = validate({ ...formData, [name]: value });
    setErrors(prev => ({ ...prev, [name]: newErrs[name] || '' }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched(t => ({ ...t, [name]: true }));
    const newErrs = validate(formData);
    setErrors(prev => ({ ...prev, [name]: newErrs[name] || '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Mark all fields touched
    setTouched({ name:true, expiryDate:true, barcode:true });
    const newErrors = validate(formData);
    setErrors(newErrors);
    if (Object.values(newErrors).some(Boolean)) return;

    setLoading(true);
    const product = {
      barcode:    formData.barcode.trim() || `manual_${Date.now()}`,
      name:       formData.name.trim(),
      brand:      formData.brand.trim() || 'Unknown',
      category:   formData.category,
      quantity:   formData.quantity.trim(),
      image:      '📦',
      expiryDate: formData.expiryDate,
      scanDate:   new Date().toISOString(),
    };
    await onProductAdded(product);
    setSaved(product);
    setLoading(false);
    setFormData({ name:'', category:'Other', expiryDate:'', barcode:'', brand:'', quantity:'' });
    setTouched({});
    setErrors({});
  };

  // Field helper
  const Field = ({ id, label, icon, error, children }) => (
    <div className="am-field">
      <label htmlFor={id} className="am-label">
        <i className={`fas ${icon}`}/> {label}
      </label>
      {children}
      {error && touched[id] && (
        <p className="field-error"><i className="fas fa-exclamation-circle"/> {error}</p>
      )}
    </div>
  );

  if (saved) {
    return (
      <div className="am-wrap">
        <div className="am-saved card">
          <div className="am-saved-icon"><i className="fas fa-check-circle"/></div>
          <h3>{saved.name} added!</h3>
          <p>Expiry: <strong>{new Date(saved.expiryDate).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</strong></p>
          <p className="am-saved-sub">You'll get email alerts 7, 3 &amp; 1 day before expiry.</p>
          <a className="am-cal-btn" href={buildCalendarUrl(saved.name, saved.expiryDate)}
            target="_blank" rel="noopener noreferrer">
            <i className="fab fa-google"/> Add 1-Day Reminder to Google Calendar
          </a>
          <button className="btn btn-ghost am-mt" onClick={() => setSaved(null)}>
            <i className="fas fa-plus"/> Add Another Product
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="am-wrap">
      <div className="am-card card">
        <h2 className="am-title"><i className="fas fa-pencil-alt"/> Add Product Manually</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="am-grid">

            <Field id="name" label="Product Name *" icon="fa-tag" error={errors.name}>
              <input id="name" name="name" type="text" className={`input-field ${touched.name&&errors.name?'error':''}`}
                value={formData.name} onChange={handleChange} onBlur={handleBlur}
                placeholder="e.g. Amul Milk 500ml" autoComplete="off"/>
            </Field>

            <Field id="brand" label="Brand" icon="fa-building" error={errors.brand}>
              <input id="brand" name="brand" type="text" className="input-field"
                value={formData.brand} onChange={handleChange}
                placeholder="e.g. Amul, Nestle" autoComplete="off"/>
            </Field>

            <Field id="category" label="Category" icon="fa-folder" error={errors.category}>
              <select id="category" name="category" className="input-field"
                value={formData.category} onChange={handleChange}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>

            <Field id="quantity" label="Quantity / Size" icon="fa-weight" error={errors.quantity}>
              <input id="quantity" name="quantity" type="text" className="input-field"
                value={formData.quantity} onChange={handleChange}
                placeholder="e.g. 500ml, 1kg"/>
            </Field>

            <Field id="expiryDate" label="Expiry Date *" icon="fa-calendar-alt" error={errors.expiryDate}>
              <input id="expiryDate" name="expiryDate" type="date"
                className={`input-field ${touched.expiryDate&&errors.expiryDate?'error':''}`}
                value={formData.expiryDate} onChange={handleChange} onBlur={handleBlur}
                min={today}/>
            </Field>

            <Field id="barcode" label="Barcode (Optional)" icon="fa-barcode" error={errors.barcode}>
              <input id="barcode" name="barcode" type="text"
                className={`input-field ${touched.barcode&&errors.barcode?'error':''}`}
                value={formData.barcode} onChange={handleChange} onBlur={handleBlur}
                placeholder="Scan or type barcode"/>
            </Field>

          </div>

          <button type="submit" className="btn btn-primary am-submit" disabled={loading}>
            {loading
              ? <><i className="fas fa-spinner fa-spin"/> Adding…</>
              : <><i className="fas fa-plus"/> Add Product</>
            }
          </button>
        </form>
      </div>
    </div>
  );
});

export default AddManual;