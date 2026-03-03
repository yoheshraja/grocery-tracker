import React, { useState, useRef, useEffect } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import expiryExtractor from './expiryDateExtractor';
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

// ── Month name → number map ─────────────────────────────────────────────────
const MONTH_MAP = {
  JAN:1, JANUARY:1,
  FEB:2, FEBRUARY:2,
  MAR:3, MARCH:3,
  APR:4, APRIL:4,
  MAY:5,
  JUN:6, JUNE:6,
  JUL:7, JULY:7,
  AUG:8, AUGUST:8,
  SEP:9, SEPTEMBER:9, SEPT:9,
  OCT:10, OCTOBER:10,
  NOV:11, NOVEMBER:11,
  DEC:12, DECEMBER:12,
};

// ── Fix common OCR character mistakes ────────────────────────────────────────
const fixOCRText = (raw) => {
  return raw
    .toUpperCase()
    // Remove noise characters that confuse parsing
    .replace(/[©®™°•·]/g, ' ')          // "© 14 JAN" → " 14 JAN"
    .replace(/[''`|\\]/g, '')
    // Fix OCR digit mistakes ONLY between actual digit characters (never inside words)
    // e.g. "2O26" → "2026" but "JAN" stays "JAN"
    .replace(/(\d)O(\d)/g, '$10$2')      // digit-O-digit → digit-0-digit
    .replace(/(\d)I(\d)/g, '$11$2')      // digit-I-digit → digit-1-digit
    .replace(/(\d)l(\d)/g, '$11$2')      // digit-l-digit → digit-1-digit
    .replace(/(\d)S(\d)/g, '$15$2')      // digit-S-digit → digit-5-digit
    .replace(/\s+/g, ' ')
    .replace(/(\d)[,](\d)/g, '$1/$2')    // "12,2025" → "12/2025"
    .replace(/(\d)[;](\d)/g, '$1/$2')    // "12;2025" → "12/2025"
    .trim();
};

// ── Build YYYY-MM-DD, only FUTURE dates allowed (expiry must be upcoming) ────
const buildDate = (yyyy, mm, dd = 1) => {
  let y = parseInt(yyyy), m = parseInt(mm), d = parseInt(dd);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

  // 2-digit year: 25→2025, 26→2026 etc. Only accept 25-39 (realistic expiry range)
  if (y < 100) {
    if (y >= 25 && y <= 39) y = 2000 + y;
    else return null; // reject ambiguous 2-digit years outside this range
  }

  // Sanity check ranges
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  if (y < 2025 || y > 2040) return null; // expiry dates are always near-future

  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;

  // EXPIRY DATE RULE: must be TODAY or in the future
  // (a product already expired today is still valid to track)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return null;  // reject all past dates — those are MFD/manufacture dates

  return date.toISOString().split('T')[0]; // YYYY-MM-DD
};

// ── Score a candidate date: higher = more likely to be expiry ────────────────
// Prefers: labelled > future > further future
const scoreDate = (dateStr, isLabelled) => {
  if (!dateStr) return -1;
  const d = new Date(dateStr);
  const today = new Date();
  const daysAhead = (d - today) / 86400000;
  // Labelled dates (with EXP/BB prefix) get strong bonus
  let score = isLabelled ? 10000 : 0;
  // Prefer dates 1 month–5 years ahead (typical expiry window)
  if (daysAhead >= 30 && daysAhead <= 5 * 365) score += 500;
  else if (daysAhead > 0 && daysAhead < 30) score += 100; // imminent expiry
  else if (daysAhead > 5 * 365) score += 50; // very far future (canned goods)
  return score + daysAhead; // tie-break by furthest date
};

// ── Pull the raw date string from OCR text to display in the text field ─────
// Returns the shortest substring that contains the detected date, e.g. "29.01.26"
// ── Main date extractor ───────────────────────────────────────────────────────
const extractDateFromText = (rawText) => {
  if (!rawText) return null;

  const t = fixOCRText(rawText);

  const MONTH_RE = '(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';

  // Label keywords that mark EXPIRY (not manufacture)
  const EXP_LABEL = '(?:BEST\\s*BEFORE|USE\\s*BY|USE\\s*BEFORE|EXPIRY\\.?\\s*DATE\\.?|EXPIRY\\.?|EXP\\.?(?:IRY|IRES?|\\s*DATE\\.?|\\s*DT\\.?)?|EXPDT\\.?|BB|B\\.B\\.|CONSUME\\s*BEFORE|CONSUME\\s*BY)';
  // Label keywords that mark MANUFACTURE — we use these to EXCLUDE nearby dates
  const MFD_LABEL = '(?:MFG\\.?\\s*DATE\\.?|MFD\\.?|MANUFACTURED|DOM|DATE\\s*OF\\s*(?:MFG|MANUFACTURING|PACKAGING|PACKING)|PACKED\\s*ON|PKD\\.?\\s*ON|MFGD?\\.?|DATE\\s*OF\\s*MFG|MFD\\s*\\.)';

  const SEP = '[\\s\\-\\/\\.\\,]?';

  // Collect ALL candidate dates with their score
  const candidates = [];

  const tryAdd = (dateStr, isLabelled) => {
    if (!dateStr) return;
    const score = scoreDate(dateStr, isLabelled);
    if (score >= 0) candidates.push({ dateStr, score });
  };

  // ── LABELLED patterns (high confidence — has EXP/BB prefix) ──────────────

  // EXP: DD/MM/YYYY or DD-MM-YY  (includes EXP.29.01.26 — no space after label)
  const p1 = new RegExp(`${EXP_LABEL}[:\\-.]?\\s*(\\d{1,2})[\\s\/\\-\\.](\\d{1,2})[\\s\/\\-\\.](\\d{2,4})`, 'gi');
  for (const m of t.matchAll(p1)) tryAdd(buildDate(m[3], m[2], m[1]), true);

  // EXP: DD-MON-YYYY  "EXP: 15-JAN-2026"
  const p2 = new RegExp(`${EXP_LABEL}\\s*[:\\-.]?\\s*(\\d{1,2})[\\s\\-\\/\\.](${MONTH_RE})[\\s\\-\\/\\.](\\d{2,4})`, 'gi');
  for (const m of t.matchAll(p2)) {
    const mo = MONTH_MAP[m[2].replace(/\.$/,'')];
    tryAdd(buildDate(m[3], mo, m[1]), true);
  }

  // EXP: MON YYYY  "BB: JAN 2026"
  const p3 = new RegExp(`${EXP_LABEL}\\s*[:\\-.]?\\s*(${MONTH_RE})[\\s\\-\\/\\.](\\d{2,4})`, 'gi');
  for (const m of t.matchAll(p3)) {
    const mo = MONTH_MAP[m[1].replace(/\.$/,'')];
    tryAdd(buildDate(m[2], mo, 1), true);
  }

  // EXP: MM/YYYY  "EXP: 06/2026"
  const p4 = new RegExp(`${EXP_LABEL}\\s*[:\\-.]?\\s*(\\d{1,2})[\\s\\/\\-\\.](\\d{4})`, 'gi');
  for (const m of t.matchAll(p4)) tryAdd(buildDate(m[2], m[1], 1), true);

  // EXP: YYYY  "BEST BEFORE 2027"
  const p5 = new RegExp(`${EXP_LABEL}\\s*[:\\-.]?\\s*(20[2-9]\\d)\\b`, 'gi');
  for (const m of t.matchAll(p5)) tryAdd(buildDate(m[1], 12, 31), true);

  // ── Build MFD exclusion zones ─────────────────────────────────────────────
  // Find positions of MFD labels so we can ignore dates near them
  const mfdPositions = [];
  const mfdRe = new RegExp(MFD_LABEL, 'gi');
  for (const m of t.matchAll(mfdRe)) mfdPositions.push(m.index);

  const nearMFD = (idx) => mfdPositions.some(pos => Math.abs(idx - pos) < 40);

  // ── UNLABELLED patterns (lower confidence — no prefix) ───────────────────

  // ISO: YYYY-MM-DD
  const p6 = /\b(20[2-9]\d)[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])\b/g;
  for (const m of t.matchAll(p6)) {
    if (!nearMFD(m.index)) tryAdd(buildDate(m[1], m[2], m[3]), false);
  }

  // DD/MM/YYYY
  const p7 = /\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](20[2-9]\d)\b/g;
  for (const m of t.matchAll(p7)) {
    if (!nearMFD(m.index)) tryAdd(buildDate(m[3], m[2], m[1]), false);
  }

  // DD-MON-YYYY  "15 JAN 2026"
  const p8 = new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])[\\s\\-\\/\\.](${MONTH_RE})[\\s\\-\\/\\.](20[2-9]\\d)\\b`, 'gi');
  for (const m of t.matchAll(p8)) {
    if (!nearMFD(m.index)) {
      const mo = MONTH_MAP[m[2].replace(/\.$/,'')];
      tryAdd(buildDate(m[3], mo, m[1]), false);
    }
  }

  // MON YYYY  "JAN 2026"
  const p9 = new RegExp(`\\b(${MONTH_RE})[\\s\\-\\/\\.](20[2-9]\\d)\\b`, 'gi');
  for (const m of t.matchAll(p9)) {
    if (!nearMFD(m.index)) {
      const mo = MONTH_MAP[m[1].replace(/\.$/,'')];
      tryAdd(buildDate(m[2], mo, 1), false);
    }
  }

  // YYYY-MON  "2026-JAN"
  const p10 = new RegExp(`\\b(20[2-9]\\d)[\\s\\-\\/\\.](${MONTH_RE})\\b`, 'gi');
  for (const m of t.matchAll(p10)) {
    if (!nearMFD(m.index)) {
      const mo = MONTH_MAP[m[2].replace(/\.$/,'')];
      tryAdd(buildDate(m[1], mo, 1), false);
    }
  }

  // MM/YYYY  "06/2026"
  const p11 = /\b(0?[1-9]|1[0-2])[\/\-](20[2-9]\d)\b/g;
  for (const m of t.matchAll(p11)) {
    if (!nearMFD(m.index)) tryAdd(buildDate(m[2], m[1], 1), false);
  }

  // MON-YYYY with hyphen "JAN-2026", "DEC-2026" (very common Indian packaging)
  const p11b = new RegExp(`\\b(${MONTH_RE})-(20[2-9]\\d)\\b`, 'gi');
  for (const m of t.matchAll(p11b)) {
    if (!nearMFD(m.index)) {
      const mo = MONTH_MAP[m[1].replace(/\.$/,'')];
      tryAdd(buildDate(m[2], mo, 1), false);
    }
  }

  // DD/MM/YY two-digit year  "31/01/26"
  const p12 = /\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.]([2-9]\d)\b/g;
  for (const m of t.matchAll(p12)) {
    if (!nearMFD(m.index)) tryAdd(buildDate(m[3], m[2], m[1]), false);
  }

  // MMYYYY no separator "062026" — common Indian stamp
  const p13 = /\b(0[1-9]|1[0-2])(20[2-9]\d)\b/g;
  for (const m of t.matchAll(p13)) {
    if (!nearMFD(m.index)) tryAdd(buildDate(m[2], m[1], 1), false);
  }

  // MON DD YYYY (US)  "JAN 15 2026"
  const p14 = new RegExp(`\\b(${MONTH_RE})[\\s\\-\\/\\.](0?[1-9]|[12]\\d|3[01])[\\s\\,\\.\\-](20[2-9]\\d)\\b`, 'gi');
  for (const m of t.matchAll(p14)) {
    if (!nearMFD(m.index)) {
      const mo = MONTH_MAP[m[1].replace(/\.$/,'')];
      tryAdd(buildDate(m[3], mo, m[2]), false);
    }
  }

  if (candidates.length === 0) return null;

  // Pick the highest-scoring candidate
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].dateStr;
};

const extractRawDateSnippet = (ocrText, parsedDate) => {
  if (!ocrText || !parsedDate) return null;
  const t = ocrText.toUpperCase();
  const MONTH_RE = '(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';
  // Try all common patterns and return the first matching raw string
  const snippetPatterns = [
    // DD.MM.YY or DD/MM/YYYY
    /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g,
    // DD MON YYYY or MON YYYY
    new RegExp(`\b\d{1,2}\s+${MONTH_RE}\s+\d{2,4}\b`, 'g'),
    new RegExp(`\b${MONTH_RE}[\s\-\/]\d{2,4}\b`, 'g'),
    // MM/YYYY
    /\d{1,2}[\/\-]\d{4}/g,
  ];
  for (const re of snippetPatterns) {
    const matches = [...t.matchAll(re)];
    for (const m of matches) {
      // Verify this snippet actually parses to our detected date
      const testDate = extractDateFromText(m[0]);
      if (testDate === parsedDate) return m[0];
    }
  }
  // Fallback: return the parsed date in a readable format
  return new Date(parsedDate + 'T00:00:00')
    .toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
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
  const [expiryDate,    setExpiryDate]   = useState(''); // YYYY-MM-DD internal value
  const [expiryText,    setExpiryText]   = useState(''); // raw text shown in input field
  const [ocrRunning,    setOcrRunning]   = useState(false);
  const [ocrRawText,    setOcrRawText]   = useState('');
  const [capturedImg,   setCapturedImg]  = useState(null);
  const [saving,        setSaving]       = useState(false);

  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const codeReader = useRef(new BrowserMultiFormatReader());

  const showProgress = (msg, type='info') => { setProgress(msg); setProgressType(type); };

  // Live parser — converts any typed format to YYYY-MM-DD as user types
  const handleExpiryTyping = (val) => {
    setExpiryText(val);
    if (!val.trim()) { setExpiryDate(''); return; }
    const parsed = extractDateFromText(val);
    if (parsed) {
      setExpiryDate(parsed);
    } else {
      // Try native Date parse as last resort (handles "2026-06-01" typed directly)
      const d = new Date(val);
      if (!isNaN(d.getTime()) && d >= new Date()) {
        setExpiryDate(d.toISOString().split('T')[0]);
      } else {
        setExpiryDate('');
      }
    }
  };


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

  // Preprocess image for better OCR on stamped/dot-matrix text
  const preprocessForOCR = (sourceCanvas) => {
    const src = sourceCanvas;
    // Create a new canvas 2x bigger — Tesseract works better on larger images
    const out = document.createElement('canvas');
    const scale = 2.5;
    out.width  = src.width  * scale;
    out.height = src.height * scale;
    const ctx = out.getContext('2d');

    // Step 1: Draw scaled up
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, out.width, out.height);

    // Step 2: Greyscale + high contrast via pixel manipulation
    const imageData = ctx.getImageData(0, 0, out.width, out.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      // Greyscale
      const grey = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      // Increase contrast: push towards black or white
      const contrast = 1.8;
      const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
      const enhanced = Math.min(255, Math.max(0, factor * (grey - 128) + 128));
      // Hard threshold: above 140 = white, below = black (helps stamped text)
      const binary = enhanced > 140 ? 255 : 0;
      data[i] = data[i+1] = data[i+2] = binary;
      data[i+3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    return out.toDataURL('image/png'); // PNG lossless — better for OCR than JPEG
  };

  const captureFrame = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return null;
    c.width = v.videoWidth||640; c.height = v.videoHeight||480;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    // Return both raw and preprocessed
    const raw = c.toDataURL('image/jpeg', 0.92);
    const processed = preprocessForOCR(c);
    return { raw, processed };
  };

  // ── STEP 1: Barcode ───────────────────────────
  const startBarcodeStep = async () => {
    setError(''); setProductData(null); setExpiryDate(''); setExpiryText('');
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
    showProgress('Capturing image…');
    const frames = captureFrame();
    if (!frames) { setOcrRunning(false); return; }
    setCapturedImg(frames.raw);
    stopCamera();

    try {
      // ── Run OCR on PREPROCESSED image (best for stamped/dot-matrix text) ──
      showProgress('Enhancing image for OCR…');
      const tesseractConfig = {
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz./-: ',
        preserve_interword_spaces: '1',
      };

      let bestText = '';
      let bestDate = null;

      // Pass 1: preprocessed image (high contrast B&W) — best for stamps
      showProgress('OCR pass 1/2 — reading stamped text…');
      try {
        const r1 = await Tesseract.recognize(frames.processed, 'eng', {
          logger: m => { if (m.status==='recognizing text') showProgress(`OCR pass 1: ${Math.round(m.progress*100)}%`); },
          ...tesseractConfig,
        });
        const d1 = extractDateFromText(r1.data.text);
        if (d1) { bestDate = d1; bestText = r1.data.text; }
        else if (!bestText) bestText = r1.data.text;
      } catch(e) { console.warn('OCR pass 1 failed', e); }

      // Pass 2: raw image — good for clear printed text
      if (!bestDate) {
        showProgress('OCR pass 2/2 — reading printed text…');
        try {
          const r2 = await Tesseract.recognize(frames.raw, 'eng', {
            logger: m => { if (m.status==='recognizing text') showProgress(`OCR pass 2: ${Math.round(m.progress*100)}%`); },
          });
          const d2 = extractDateFromText(r2.data.text);
          if (d2) { bestDate = d2; bestText = r2.data.text; }
          else if (r2.data.text.length > bestText.length) bestText = r2.data.text;
        } catch(e) { console.warn('OCR pass 2 failed', e); }
      }

      setOcrRawText(bestText);

      if (bestDate) {
        // Show what OCR actually read in the text field, not a formatted version
        // Extract just the date portion from OCR text to show in the field
        const rawSnippet = extractRawDateSnippet(bestText, bestDate);
        setExpiryText(rawSnippet || bestDate);
        setExpiryDate(bestDate);
        const friendly = new Date(bestDate + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
        showProgress(`✅ Expiry date detected: ${friendly}`, 'success');
      } else {
        showProgress('⚠️ Could not detect date — please enter it manually below.', 'warn');
      }
    } catch(e) {
      console.error('OCR error:', e);
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
      setStep(0); setProductData(null); setExpiryDate(''); setExpiryText('');
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
    setProductData(null); setExpiryDate(''); setExpiryText('');
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
                <i className="fas fa-tag"></i> Expiry Date *
                {expiryDate && <span className="sc-ocr-badge"><i className="fas fa-magic"></i> OCR auto-filled</span>}
              </label>
              <input
                type="text"
                value={expiryText}
                onChange={e => handleExpiryTyping(e.target.value)}
                placeholder="Expiry date will auto-fill after OCR scan"
                className={`sc-expiry-text ${expiryDate ? 'valid' : expiryText ? 'invalid' : ''}`}
                autoComplete="off"
              />
              {expiryDate && (
                <div className="sc-date-parsed">
                  <i className="fas fa-check-circle"></i>
                  <strong>{new Date(expiryDate + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</strong>
                  <span className="sc-date-iso">{expiryDate}</span>
                </div>
              )}
              {expiryText && !expiryDate && (
                <p className="sc-field-hint">⚠️ Not recognised — try: 29/01/2026 · JAN 2026 · 29.01.26</p>
              )}
              {!expiryText && (
                <p className="sc-field-hint-soft">OCR will auto-fill this after Step 2 scan</p>
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
