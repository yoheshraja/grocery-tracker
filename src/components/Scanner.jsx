import React, { useState, useRef, useEffect } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import Tesseract from 'tesseract.js';
import './Scanner.css';

// ── Category mapper — checks ALL OpenFoodFacts tags ──
const CATEGORY_RULES = [
  { cat: 'Dairy',          keys: ['dairy','milk','cheese','yogurt','yoghurt','butter','cream','paneer','ghee','curd','lassi','whey'] },
  { cat: 'Beverages',      keys: ['beverage','drink','water','soda','juice','tea','coffee','cola','smoothie','shake','energy drink','soft drink','squash','nectar','lemonade','coconut water'] },
  { cat: 'Fruits',         keys: ['fruit','apple','mango','banana','orange','grape','berry','berries','pineapple','papaya','guava','pomegranate','lychee','melon'] },
  { cat: 'Vegetables',     keys: ['vegetable','veggie','spinach','tomato','potato','onion','carrot','pea','bean','lentil','dal','rajma','chickpea','chana','mushroom','broccoli','cauliflower'] },
  { cat: 'Meat & Seafood', keys: ['meat','chicken','mutton','lamb','beef','pork','fish','seafood','prawn','shrimp','tuna','salmon','egg','poultry'] },
  { cat: 'Bakery',         keys: ['bread','biscuit','bakery','cookie','cake','pastry','rusk','cracker','wafer','muffin','bun','roll','chapati','roti','naan','pav'] },
  { cat: 'Snacks',         keys: ['snack','chip','namkeen','bhujia','mixture','popcorn','chocolate','candy','sweet','mithai','dessert','ice cream','icecream','halwa','ladoo','confection','nuts','peanut','cashew','almond','raisin'] },
  { cat: 'Frozen Foods',   keys: ['frozen','freeze','ice cream','icecream'] },
  { cat: 'Canned Goods',   keys: ['canned','tinned','preserved','pickled','pickle','achar','jam','jelly','marmalade','conserve'] },
  { cat: 'Condiments',     keys: ['sauce','condiment','ketchup','mayonnaise','mustard','oil','vinegar','spice','masala','chutney','paste','dressing','seasoning','relish','curry'] },
  { cat: 'Personal Care',  keys: ['soap','shampoo','lotion','toothpaste','deodorant','skincare','haircare','personal care','hygiene','detergent','cleanser'] },
];

const mapCategory = (tags = []) => {
  if (!tags || !tags.length) return 'Other';
  const allTags = tags
    .map(t => t.split(':').pop().replace(/-/g, ' ').replace(/_/g, ' ').toLowerCase())
    .join(' ');
  for (const { cat, keys } of CATEGORY_RULES) {
    if (keys.some(k => allTags.includes(k))) return cat;
  }
  return 'Other';
};

const getCategoryEmoji = (cat='') => {
  const m = { dairy:'🥛', fruits:'🍎', vegetables:'🥦', 'meat & seafood':'🥩', bakery:'🍞', snacks:'🍪', beverages:'🥤', 'canned goods':'🥫', 'frozen foods':'🧊', condiments:'🧴', 'personal care':'🧼', other:'📦' };
  return m[(cat||'').toLowerCase()] || '📦';
};

// ── Month name → number map ───────────────────────
const MONTH_MAP = {
  JAN:1, JANUARY:1, JAN:1,
  FEB:2, FEBRUARY:2, FEB:2,
  MAR:3, MARCH:3, MAR:3,
  APR:4, APRIL:4, APR:4,
  MAY:5,
  JUN:6, JUNE:6, JUN:6,
  JUL:7, JULY:7, JUL:7,
  AUG:8, AUGUST:8, AUG:8,
  SEP:9, SEPTEMBER:9, SEPT:9, SEP:9,
  OCT:10, OCTOBER:10, OCT:10,
  NOV:11, NOVEMBER:11, NOV:11,
  DEC:12, DECEMBER:12, DEC:12,
};

// Validate and build YYYY-MM-DD, returns null if invalid/out-of-range
const buildDate = (yyyy, mm, dd = 1) => {
  const y = parseInt(yyyy), m = parseInt(mm), d = parseInt(dd);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  // 2-digit year fix: 25 → 2025, 99 → 1999 (treat <50 as 2000s)
  const year  = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
  const month = m - 1; // JS months 0-indexed
  if (month < 0 || month > 11) return null;
  if (d < 1 || d > 31) return null;
  const date  = new Date(year, month, d);
  if (isNaN(date.getTime())) return null;
  // Allow up to 1 year in the past (recently expired) and 15 years future
  const today = new Date();
  const min   = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const max   = new Date(today.getFullYear() + 15, 11, 31);
  if (date < min || date > max) return null;
  return date.toISOString().split('T')[0];
};

// ── Extract expiry date from OCR text ────────────
// Handles every format found on Indian & global product packaging
const extractDateFromText = (text) => {
  if (!text) return null;

  // Normalise: uppercase, collapse whitespace, fix common OCR mistakes
  let t = text.toUpperCase()
    .replace(/[oO]/g, match => /\d/.test(match) ? '0' : match) // OCR o→0 only near digits
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, '')       // remove stray quotes
    .replace(/(\d)[,](\d)/g, '$1/$2'); // "12,2025" → "12/2025"

  const MONTH_RE = '(?:JAN(?:UARY|\\.)?|FEB(?:RUARY|\\.)?|MAR(?:CH|\\.)?|APR(?:IL|\\.)?|MAY|JUN(?:E|\\.)?|JUL(?:Y|\\.)?|AUG(?:UST|\\.)?|SEP(?:T(?:EMBER)?|\\.)?|OCT(?:OBER|\\.)?|NOV(?:EMBER|\\.)?|DEC(?:EMBER|\\.)?)';
  const SEP = '[\\s\\-\\/\\.\\,]?'; // flexible separator

  // ────────────────────────────────────────────────
  // All patterns return [fullMatch, ...groups]
  // Priority order: labelled > specific format > generic
  // ────────────────────────────────────────────────
  const patterns = [

    // ── 1. Labelled — "BEST BEFORE: 12/2025", "EXP: 01-JAN-2026", "USE BY 31.01.26" ──
    // With full date DD/MM/YYYY or DD-MM-YY
    { re: new RegExp(`(?:BEST\\s*BEFORE|USE\\s*BY|EXPIRY\\s*DATE|EXPIRY|EXP(?:IRES?)?|BB|MFG\\.?\\s*DATE|MFD)${SEP}[:\\-]?${SEP}(\\d{1,2})[\\s\\/\\-\\.](\\d{1,2})[\\s\\/\\-\\.](\\d{2,4})`,'i'),
      parse: m => buildDate(m[3], m[2], m[1]) },   // DD MM YYYY

    // With DD-MON-YYYY  e.g. "EXP: 15-JAN-2026"
    { re: new RegExp(`(?:BEST\\s*BEFORE|USE\\s*BY|EXPIRY\\s*DATE|EXPIRY|EXP(?:IRES?)?|BB)${SEP}[:\\-]?${SEP}(\\d{1,2})[\\s\\-\\/\\.](${MONTH_RE})[\\s\\-\\/\\.](\\d{2,4})`,'i'),
      parse: m => { const mo = MONTH_MAP[m[2].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[3], mo, m[1]) : null; } },

    // With MON-YYYY  e.g. "BB: JAN 2026"
    { re: new RegExp(`(?:BEST\\s*BEFORE|USE\\s*BY|EXPIRY\\s*DATE|EXPIRY|EXP(?:IRES?)?|BB)${SEP}[:\\-]?${SEP}(${MONTH_RE})[\\s\\-\\/\\.](\\d{2,4})`,'i'),
      parse: m => { const mo = MONTH_MAP[m[1].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[2], mo, 1) : null; } },

    // With MM/YYYY  e.g. "EXP: 06/2026"
    { re: new RegExp(`(?:BEST\\s*BEFORE|USE\\s*BY|EXPIRY\\s*DATE|EXPIRY|EXP(?:IRES?)?|BB)${SEP}[:\\-]?${SEP}(\\d{1,2})[\\s\\/\\-\\.](\\d{4})`,'i'),
      parse: m => buildDate(m[2], m[1], 1) },

    // ── 2. YYYY-MM-DD (ISO, common on imports) ──
    { re: /\b(20\d{2})[\-\/\.](0?[1-9]|1[0-2])[\-\/\.](0?[1-9]|[12]\d|3[01])\b/,
      parse: m => buildDate(m[1], m[2], m[3]) },

    // ── 3. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY ──
    { re: /\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](20\d{2}|[2-9]\d)\b/,
      parse: m => buildDate(m[3], m[2], m[1]) },

    // ── 4. DD-MON-YYYY  "15 JAN 2026" ──
    { re: new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])[\\s\\-\\/\\.](${MONTH_RE})[\\s\\-\\/\\.](20\\d{2}|[2-9]\\d)\\b`,'i'),
      parse: m => { const mo = MONTH_MAP[m[2].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[3], mo, m[1]) : null; } },

    // ── 5. MON-YYYY  "JAN 2026", "JANUARY 26" ──
    { re: new RegExp(`\\b(${MONTH_RE})[\\s\\-\\/\\.](20\\d{2}|[2-9]\\d)\\b`,'i'),
      parse: m => { const mo = MONTH_MAP[m[1].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[2], mo, 1) : null; } },

    // ── 6. YYYY-MON  "2026-JAN" ──
    { re: new RegExp(`\\b(20\\d{2})[\\s\\-\\/\\.](${MONTH_RE})\\b`,'i'),
      parse: m => { const mo = MONTH_MAP[m[2].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[1], mo, 1) : null; } },

    // ── 7. MM/YYYY  "06/2026", "06-2026" ──
    { re: /\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/,
      parse: m => buildDate(m[2], m[1], 1) },

    // ── 8. MMYYYY (no separator, common Indian print) "062026" ──
    { re: /\b(0[1-9]|1[0-2])(20[2-9]\d)\b/,
      parse: m => buildDate(m[2], m[1], 1) },

    // ── 9. DDMMYYYY (no sep) "31012026" ──
    { re: /\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d{2})\b/,
      parse: m => buildDate(m[3], m[2], m[1]) },

    // ── 10. DD/MM/YY two-digit year "31/01/26" ──
    { re: /\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.]([2-9]\d)\b/,
      parse: m => buildDate(m[3], m[2], m[1]) },

    // ── 11. MON DD YYYY (US format) "JAN 15 2026" ──
    { re: new RegExp(`\\b(${MONTH_RE})[\\s\\-\\/\\.](0?[1-9]|[12]\\d|3[01])[\\s\\,\\.\\-](20\\d{2})\\b`,'i'),
      parse: m => { const mo = MONTH_MAP[m[1].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[3], mo, m[2]) : null; } },

    // ── 12. YYYY/MM/DD ──
    { re: /\b(20\d{2})[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])\b/,
      parse: m => buildDate(m[1], m[2], m[3]) },

    // ── 13. Loose: any 4-digit year next to a month name ──
    { re: new RegExp(`(20\\d{2})[\\s\\-\\/\\.](${MONTH_RE})`,'i'),
      parse: m => { const mo = MONTH_MAP[m[2].replace(/\.$/,'').toUpperCase()]; return mo ? buildDate(m[1], mo, 1) : null; } },
  ];

  // Try all patterns, return first valid date found
  for (const { re, parse } of patterns) {
    // Use matchAll to catch all occurrences and pick latest valid
    const matches = [...t.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    for (const m of matches) {
      try {
        const result = parse(m);
        if (result) return result;
      } catch(e) { /* skip bad match */ }
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
  const [expiryDate,    setExpiryDate]   = useState(''); // YYYY-MM-DD for calendar input
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
        const friendly = new Date(found + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        setExpiryDate(found);
        setExpiryText(friendly); // fills the text input field instead of calendar
        showProgress(`✅ Expiry date detected: ${friendly}`, 'success');
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

            <div className="sc-field sc-field--full">
              <label>
                <i className="fas fa-calendar-alt"></i> Expiry Date *
                {expiryDate && <span className="sc-ocr-badge"><i className="fas fa-magic"></i> OCR auto-filled</span>}
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
                min={new Date(Date.now() - 365*86400000).toISOString().split('T')[0]}
                max={new Date(Date.now() + 15*365*86400000).toISOString().split('T')[0]}
                className={expiryDate ? 'sc-input-valid' : ''}
              />
              {expiryDate && (
                <div className="sc-date-parsed">
                  <i className="fas fa-check-circle"></i>
                  <strong>{new Date(expiryDate + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</strong>
                </div>
              )}
              {!expiryDate && (
                <p className="sc-field-hint-soft">OCR will auto-fill this — or pick from calendar</p>
              )}
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
