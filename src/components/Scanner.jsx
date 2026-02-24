import React, { useState, useRef, useEffect } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import Tesseract from 'tesseract.js';
import './Scanner.css';

// ── Category mapper ───────────────────────────────
const mapCategory = (tags = []) => {
  if (!tags || !tags.length) return 'Other';
  const raw = tags[0].split(':').pop().replace(/-/g,' ').toLowerCase();
  if (raw.includes('dairy')||raw.includes('milk')||raw.includes('cheese')||raw.includes('yogurt')) return 'Dairy';
  if (raw.includes('fruit')||raw.includes('juice')) return 'Fruits';
  if (raw.includes('vegetable')||raw.includes('veggie')) return 'Vegetables';
  if (raw.includes('meat')||raw.includes('chicken')||raw.includes('fish')||raw.includes('seafood')) return 'Meat & Seafood';
  if (raw.includes('bread')||raw.includes('biscuit')||raw.includes('bakery')||raw.includes('cake')) return 'Bakery';
  if (raw.includes('snack')||raw.includes('chip')||raw.includes('chocolate')||raw.includes('candy')) return 'Snacks';
  if (raw.includes('beverage')||raw.includes('drink')||raw.includes('water')||raw.includes('soda')||raw.includes('tea')||raw.includes('coffee')) return 'Beverages';
  if (raw.includes('canned')||raw.includes('preserved')||raw.includes('tinned')) return 'Canned Goods';
  if (raw.includes('frozen')) return 'Frozen Foods';
  if (raw.includes('sauce')||raw.includes('condiment')||raw.includes('oil')||raw.includes('vinegar')) return 'Condiments';
  return 'Other';
};

const getCategoryEmoji = (cat='') => {
  const m = { dairy:'🥛', fruits:'🍎', vegetables:'🥦', 'meat & seafood':'🥩', bakery:'🍞', snacks:'🍪', beverages:'🥤', 'canned goods':'🥫', 'frozen foods':'🧊', condiments:'🧴', 'personal care':'🧼', other:'📦' };
  return m[(cat||'').toLowerCase()] || '📦';
};

// ── Extract expiry date from OCR text ────────────
const extractDateFromText = (text) => {
  if (!text) return null;
  const t = text.toUpperCase();
  const patterns = [
    /(?:BEST\s*BEFORE|BB|USE\s*BY|EXPIRY|EXP(?:IRES?)?)\s*[:\-.]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:BEST\s*BEFORE|BB|USE\s*BY|EXPIRY|EXP(?:IRES?)?)\s*[:\-.]?\s*(\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:BEST\s*BEFORE|BB|USE\s*BY|EXPIRY|EXP(?:IRES?)?)\s*[:\-.]?\s*(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{2,4})/i,
    /\b(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})\b/i,
    /\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})\b/i,
    /\b(\d{2}[\/\-]\d{4})\b/,
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
  ];
  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (match) {
      const raw = match[1].trim();
      try {
        if (/^\d{2}[\/\-]\d{4}$/.test(raw)) {
          const [mm, yyyy] = raw.split(/[\/\-]/);
          const d = new Date(parseInt(yyyy), parseInt(mm)-1, 1);
          if (!isNaN(d) && d > new Date()) return d.toISOString().split('T')[0];
        }
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          const today = new Date();
          const min = new Date(today.getFullYear()-1, today.getMonth(), today.getDate());
          const max = new Date(today.getFullYear()+10, 0, 1);
          if (d >= min && d <= max) return d.toISOString().split('T')[0];
        }
      } catch(e) {}
    }
  }
  return null;
};

// ── Step Indicator ────────────────────────────────
const StepIndicator = ({ step }) => (
  <div className="step-indicator">
    {[
      { n:1, label:'Scan Barcode',   icon:'fa-barcode'       },
      { n:2, label:'Read Expiry',    icon:'fa-calendar-alt'  },
      { n:3, label:'Confirm & Save', icon:'fa-check-circle'  },
    ].map(({ n, label, icon }, i) => (
      <React.Fragment key={n}>
        <div className={`si-step ${step===n?'active':''} ${step>n?'done':''}`}>
          <div className="si-circle">
            <i className={`fas ${step>n?'fa-check':icon}`}></i>
          </div>
          <span>{label}</span>
        </div>
        {i < 2 && <div className={`si-line ${step>n?'done':''}`} />}
      </React.Fragment>
    ))}
  </div>
);

// ════════════════════════════════════════════════
const Scanner = ({ onProductScanned }) => {
  const [step,          setStep]         = useState(0);
  const [scanning,      setScanning]     = useState(false);
  const [progress,      setProgress]     = useState('');
  const [progressType,  setProgressType] = useState('info'); // info|success|warn
  const [error,         setError]        = useState('');
  const [productData,   setProductData]  = useState(null);
  const [expiryDate,    setExpiryDate]   = useState('');
  const [ocrRunning,    setOcrRunning]   = useState(false);
  const [ocrRawText,    setOcrRawText]   = useState('');
  const [capturedImg,   setCapturedImg]  = useState(null);
  const [saving,        setSaving]       = useState(false);

  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const codeReader = useRef(new BrowserMultiFormatReader());

  const showProgress = (msg, type='info') => { setProgress(msg); setProgressType(type); };

  // ── Camera helpers ────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:'environment', width:{ ideal:1280 }, height:{ ideal:720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      return true;
    } catch(err) {
      setError(err.name==='NotAllowedError' ? 'Camera permission denied. Tap Allow when browser asks.'
             : err.name==='NotFoundError'   ? 'No camera found on this device.'
             : 'Camera error: ' + err.message);
      return false;
    }
  };

  const stopCamera = () => {
    try { codeReader.current.reset(); } catch(e) {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  };

  const captureFrame = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return null;
    c.width = v.videoWidth||640; c.height = v.videoHeight||480;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  };

  // ── STEP 1: Barcode ───────────────────────────
  const startBarcodeStep = async () => {
    setError(''); setProductData(null); setExpiryDate('');
    setOcrRawText(''); setCapturedImg(null); setProgress('');
    setStep(1); setScanning(true);
    showProgress('Opening camera…');
    const ok = await startCamera();
    if (!ok) { setStep(0); setScanning(false); return; }
    showProgress('Point camera at the barcode on the product…');

    await new Promise(r => setTimeout(r, 500));
    codeReader.current.decodeFromVideoDevice(null, videoRef.current, async (result, err) => {
      if (result) {
        const barcode = result.getText();
        codeReader.current.reset();
        showProgress(`Barcode: ${barcode} — looking up product…`);
        await fetchProduct(barcode);
      }
      if (err && !(err instanceof NotFoundException)) console.warn('Scan:', err.message);
    });
  };

  // ── OpenFoodFacts fetch ───────────────────────
  const fetchProduct = async (barcode) => {
    try {
      const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const p = data.product;
        setProductData({
          barcode,
          name:     p.product_name || p.product_name_en || p.abbreviated_product_name || '',
          brand:    p.brands || '',
          category: mapCategory(p.categories_tags),
          image:    p.image_front_url || p.image_url || null,
          quantity: p.quantity || '',
        });
        showProgress('✅ Product found! Now read the expiry date.', 'success');
      } else {
        setProductData({ barcode, name:'', brand:'', category:'Other', image:null, quantity:'' });
        showProgress('⚠️ Product not in database — you can enter details manually.', 'warn');
      }
    } catch(e) {
      setProductData({ barcode, name:'', brand:'', category:'Other', image:null, quantity:'' });
      showProgress('⚠️ Could not fetch product info — enter manually.', 'warn');
    }
    stopCamera();
    setStep(2);
  };

  // ── STEP 2: OCR ───────────────────────────────
  const startOCRCamera = async () => {
    setError('');
    showProgress('Opening camera…');
    setScanning(true);
    const ok = await startCamera();
    if (!ok) { setScanning(false); setProgress(''); return; }
    showProgress('Point camera at the expiry/best-before date on the package…');
  };

  const captureAndOCR = async () => {
    setOcrRunning(true);
    showProgress('Capturing…');
    const img = captureFrame();
    if (!img) { setOcrRunning(false); return; }
    setCapturedImg(img);
    stopCamera();
    showProgress('Reading text with OCR…');

    try {
      const { data:{ text } } = await Tesseract.recognize(img, 'eng', {
        logger: m => {
          if (m.status==='recognizing text')
            showProgress(`OCR reading: ${Math.round(m.progress*100)}%`);
        }
      });
      setOcrRawText(text);
      const found = extractDateFromText(text);
      if (found) {
        setExpiryDate(found);
        showProgress(`✅ Expiry date detected: ${new Date(found).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}`, 'success');
      } else {
        showProgress('⚠️ Could not detect date — please enter it manually below.', 'warn');
      }
    } catch(e) {
      showProgress('⚠️ OCR failed — please enter expiry date below.', 'warn');
    }
    setOcrRunning(false);
    setStep(3);
  };

  const skipToConfirm = () => { stopCamera(); setStep(3); setProgress(''); };

  // ── STEP 3: Save ──────────────────────────────
  const handleSave = async () => {
    if (!productData || !expiryDate) return;
    setSaving(true);
    try {
      await onProductScanned({
        barcode:   productData.barcode,
        name:      productData.name  || `Product ${productData.barcode}`,
        brand:     productData.brand || 'Unknown',
        category:  productData.category,
        image:     productData.image || getCategoryEmoji(productData.category),
        quantity:  productData.quantity || '',
        expiryDate,
        scanDate:  new Date().toISOString(),
      });
      setStep(0); setProductData(null); setExpiryDate('');
      setOcrRawText(''); setCapturedImg(null);
      showProgress('✅ Product added to your inventory!', 'success');
      setTimeout(() => setProgress(''), 3500);
    } catch(e) {
      setError('Failed to save: ' + e.message);
    }
    setSaving(false);
  };

  const reset = () => {
    stopCamera();
    setStep(0); setProgress(''); setError('');
    setProductData(null); setExpiryDate('');
    setOcrRawText(''); setCapturedImg(null);
  };

  useEffect(() => () => stopCamera(), []);

  // ════════════ RENDER ════════════
  return (
    <div className="scanner-wrap">

      {/* Header */}
      <div className="sc-header">
        <h2><i className="fas fa-camera-retro"></i> Product Scanner</h2>
        <p>Scan barcode → Read expiry date → Save to inventory</p>
      </div>

      {/* Steps */}
      {step > 0 && <StepIndicator step={step} />}

      {/* Progress bar */}
      {progress && (
        <div className={`sc-progress sc-progress--${progressType}`}>
          <i className={`fas ${progressType==='success'?'fa-check-circle':progressType==='warn'?'fa-exclamation-triangle':'fa-spinner fa-spin'}`}></i>
          <span>{progress}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="sc-error">
          <i className="fas fa-exclamation-circle"></i>
          <span>{error}</span>
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* ─── IDLE ─── */}
      {step === 0 && (
        <div className="sc-idle">
          <div className="sc-idle-icon"><i className="fas fa-barcode"></i></div>
          <h3>Ready to Scan</h3>
          <p>Point your camera at a product barcode. FreshTrack will automatically look up the product name, brand, and category, then help you read the expiry date.</p>
          <button className="sc-btn sc-btn--primary sc-btn--lg" onClick={startBarcodeStep}>
            <i className="fas fa-camera"></i> Start Scanning
          </button>
          <div className="sc-hiw">
            <div className="sc-hiw-step"><div className="sc-hiw-num">1</div><i className="fas fa-barcode"></i><span>Scan barcode</span></div>
            <div className="sc-hiw-arrow">→</div>
            <div className="sc-hiw-step"><div className="sc-hiw-num">2</div><i className="fas fa-calendar-alt"></i><span>Read expiry</span></div>
            <div className="sc-hiw-arrow">→</div>
            <div className="sc-hiw-step"><div className="sc-hiw-num">3</div><i className="fas fa-check"></i><span>Save</span></div>
          </div>
        </div>
      )}

      {/* ─── STEP 1: Barcode camera ─── */}
      {step === 1 && (
        <div className="sc-camera-step">
          <div className="sc-viewport">
            <video ref={videoRef} className="sc-video" playsInline muted autoPlay />
            <canvas ref={canvasRef} style={{display:'none'}} />
            <div className="sc-overlay">
              <div className="sc-barcode-box">
                <div className="sc-corner tl"/><div className="sc-corner tr"/>
                <div className="sc-corner bl"/><div className="sc-corner br"/>
                <div className="sc-scanline"/>
              </div>
              <p className="sc-overlay-hint">Hold steady — scanning for barcode…</p>
            </div>
          </div>
          <button className="sc-btn sc-btn--ghost" onClick={reset}><i className="fas fa-times"></i> Cancel</button>
        </div>
      )}

      {/* ─── STEP 2: OCR expiry ─── */}
      {step === 2 && (
        <div className="sc-ocr-step">
          {/* Product found card */}
          {productData && (
            <div className="sc-product-card">
              {productData.image
                ? <img src={productData.image} alt="" className="sc-product-img" />
                : <div className="sc-product-emoji">{getCategoryEmoji(productData.category)}</div>
              }
              <div className="sc-product-details">
                {productData.name
                  ? <><h4>{productData.name}</h4><p>{productData.brand}{productData.brand&&productData.category?' · ':''}{productData.category}</p></>
                  : <><h4 className="sc-not-found">Not found in database</h4><p>Enter product name in next step</p></>
                }
                <code>{productData.barcode}</code>
              </div>
            </div>
          )}

          <div className="sc-ocr-tip">
            <i className="fas fa-lightbulb"></i>
            <div>
              <strong>Now scan the expiry date</strong>
              <p>Find the "Best Before" or "Use By" date printed on the package. Point your camera directly at it, then tap Capture.</p>
            </div>
          </div>

          {scanning ? (
            <div className="sc-viewport">
              <video ref={videoRef} className="sc-video" playsInline muted autoPlay />
              <canvas ref={canvasRef} style={{display:'none'}} />
              <div className="sc-overlay sc-overlay--ocr">
                <div className="sc-ocr-box"><span>Expiry Date</span></div>
                <p className="sc-overlay-hint">Keep expiry date in the blue box — then tap Capture</p>
              </div>
            </div>
          ) : (
            <div className="sc-ocr-placeholder">
              <i className="fas fa-calendar-alt"></i>
              <p>Tap "Open Camera" to read expiry date</p>
            </div>
          )}

          <div className="sc-ocr-actions">
            {!scanning && !ocrRunning && (
              <button className="sc-btn sc-btn--primary" onClick={startOCRCamera}>
                <i className="fas fa-camera"></i> Open Camera for Expiry Date
              </button>
            )}
            {scanning && !ocrRunning && (
              <button className="sc-btn sc-btn--capture" onClick={captureAndOCR}>
                <i className="fas fa-circle"></i> Capture & Read Expiry Date
              </button>
            )}
            {ocrRunning && (
              <button className="sc-btn sc-btn--primary" disabled>
                <i className="fas fa-spinner fa-spin"></i> Reading…
              </button>
            )}
            <button className="sc-btn sc-btn--ghost" onClick={skipToConfirm}>
              <i className="fas fa-forward"></i> Skip — Enter Date Manually
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Confirm ─── */}
      {step === 3 && productData && (
        <div className="sc-confirm-step">
          <h3><i className="fas fa-clipboard-check"></i> Review & Confirm</h3>

          {capturedImg && (
            <div className="sc-captured">
              <img src={capturedImg} alt="Captured" className="sc-captured-img" />
              {ocrRawText && (
                <div className="sc-ocr-raw">
                  <i className="fas fa-eye"></i>
                  <span>OCR read: <em>{ocrRawText.replace(/\n/g,' ').substring(0,100)}</em></span>
                </div>
              )}
            </div>
          )}

          <div className="sc-form">
            <div className="sc-field sc-field--full">
              <label><i className="fas fa-tag"></i> Product Name *</label>
              <input
                type="text"
                value={productData.name}
                onChange={e => setProductData({...productData, name:e.target.value})}
                placeholder="Enter product name"
              />
            </div>

            <div className="sc-field">
              <label><i className="fas fa-building"></i> Brand</label>
              <input
                type="text"
                value={productData.brand}
                onChange={e => setProductData({...productData, brand:e.target.value})}
                placeholder="e.g. Amul, Nestle"
              />
            </div>

            <div className="sc-field">
              <label><i className="fas fa-folder"></i> Category</label>
              <select value={productData.category} onChange={e => setProductData({...productData, category:e.target.value})}>
                {['Dairy','Fruits','Vegetables','Meat & Seafood','Bakery','Snacks','Beverages','Canned Goods','Frozen Foods','Condiments','Personal Care','Other'].map(c=>(
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="sc-field">
              <label>
                <i className="fas fa-calendar-alt"></i> Expiry Date *
                {expiryDate && <span className="sc-ocr-badge"><i className="fas fa-magic"></i> OCR auto-filled</span>}
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
              />
              {!expiryDate && <p className="sc-field-hint">Please enter the expiry date from the package</p>}
            </div>

            <div className="sc-field">
              <label><i className="fas fa-weight"></i> Quantity / Size</label>
              <input
                type="text"
                value={productData.quantity}
                onChange={e => setProductData({...productData, quantity:e.target.value})}
                placeholder="e.g. 500ml, 1kg"
              />
            </div>
          </div>

          <div className="sc-confirm-actions">
            <button className="sc-btn sc-btn--ghost" onClick={reset}>
              <i className="fas fa-times"></i> Cancel
            </button>
            <button
              className="sc-btn sc-btn--primary"
              onClick={handleSave}
              disabled={!productData.name||!expiryDate||saving}
            >
              {saving
                ? <><i className="fas fa-spinner fa-spin"></i> Saving…</>
                : <><i className="fas fa-check"></i> Add to Inventory</>
              }
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default Scanner;
