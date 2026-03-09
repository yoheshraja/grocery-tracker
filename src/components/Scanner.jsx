/**
 * Scanner.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * 3-step product scanner:
 *   Step 1 → Scan barcode   (ZXing camera)
 *   Step 2 → OCR expiry     (Tesseract + image preprocessing + smart detection)
 *   Step 3 → Confirm & save (editable form, expiry field auto-filled by OCR)
 *
 * IMAGE PREPROCESSING PIPELINE (6 variants, tried in order):
 *   Greyscale 3×  →  High contrast 3×  →  Threshold 150  →  Threshold 100
 *   →  Inverted threshold  →  Raw colour 2×
 *
 * OCR STRATEGY:
 *   - tessedit_char_whitelist limits characters → less noise
 *   - PSM 7 (single line) tried first → best for zoomed-in date shots
 *   - PSM 6 (block) + PSM 11 (sparse) as fallbacks
 *   - Bounding-box word-level search: keyword found → check next 3–6 words only
 *   - Full-text fallback if bounding-box search finds nothing
 *
 * EXPIRY FIELD:
 *   - OCR fills the text input with the raw detected string (e.g. "EXP 29/01/26")
 *   - User sees exactly what was read and can edit freely
 *   - Live parsing: every keystroke tries to parse the value into YYYY-MM-DD
 *   - Green border = valid date parsed. Red = not recognised yet.
 *   - Confirmation row shows "29 January 2026" + "2026-01-29"
 *   - Save button is disabled until a valid YYYY-MM-DD is confirmed
 */

import React, { useState, useRef, useEffect } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import Tesseract from 'tesseract.js';
import './Scanner.css';
import {
  extractExpiryDate,
  extractExpiryFromWords,
  parseTypedDate,
  formatISO,
} from '../utils/Ocrdateextractor';

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY MAPPING
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_RULES = [
  { cat: 'Dairy',          keys: ['dairy','milk','cheese','yogurt','yoghurt','butter','cream','paneer','ghee','curd','lassi','whey'] },
  { cat: 'Beverages',      keys: ['beverage','drink','water','soda','juice','tea','coffee','cola','smoothie','shake','energy drink','soft drink','squash','nectar','lemonade','coconut water'] },
  { cat: 'Fruits',         keys: ['fruit','apple','mango','banana','orange','grape','berry','berries','pineapple','papaya','guava','pomegranate','lychee','melon'] },
  { cat: 'Vegetables',     keys: ['vegetable','veggie','spinach','tomato','potato','onion','carrot','pea','bean','lentil','dal','rajma','chickpea','chana','mushroom','broccoli','cauliflower'] },
  { cat: 'Meat & Seafood', keys: ['meat','chicken','mutton','lamb','beef','pork','fish','seafood','prawn','shrimp','tuna','salmon','egg','poultry'] },
  { cat: 'Bakery',         keys: ['bread','biscuit','bakery','cookie','cake','pastry','rusk','cracker','wafer','muffin','bun','roll','chapati','roti','naan','pav'] },
  { cat: 'Snacks',         keys: ['snack','chip','namkeen','bhujia','mixture','popcorn','chocolate','candy','sweet','mithai','dessert','ice cream','icecream','halwa','ladoo','confection','nuts','peanut','cashew','almond','raisin'] },
  { cat: 'Frozen Foods',   keys: ['frozen','freeze'] },
  { cat: 'Canned Goods',   keys: ['canned','tinned','preserved','pickled','pickle','achar','jam','jelly','marmalade','conserve'] },
  { cat: 'Condiments',     keys: ['sauce','condiment','ketchup','mayonnaise','mustard','oil','vinegar','spice','masala','chutney','paste','dressing','seasoning','relish','curry'] },
  { cat: 'Personal Care',  keys: ['soap','shampoo','lotion','toothpaste','deodorant','skincare','haircare','personal care','hygiene','detergent','cleanser'] },
];

const mapCategory = (tags = []) => {
  if (!tags?.length) return 'Other';
  const all = tags
    .map(t => t.split(':').pop().replace(/[-_]/g, ' ').toLowerCase())
    .join(' ');
  for (const { cat, keys } of CATEGORY_RULES) {
    if (keys.some(k => all.includes(k))) return cat;
  }
  return 'Other';
};

const EMOJI_MAP = {
  dairy:'🥛', fruits:'🍎', vegetables:'🥦', 'meat & seafood':'🥩',
  bakery:'🍞', snacks:'🍪', beverages:'🥤', 'canned goods':'🥫',
  'frozen foods':'🧊', condiments:'🧴', 'personal care':'🧼', other:'📦',
};
const emoji = (cat = '') => EMOJI_MAP[(cat || '').toLowerCase()] || '📦';

const ALL_CATEGORIES = [
  'Dairy','Fruits','Vegetables','Meat & Seafood','Bakery','Snacks',
  'Beverages','Canned Goods','Frozen Foods','Condiments','Personal Care','Other',
];

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE PREPROCESSING — 6 variants
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Builds 6 preprocessed versions of the captured video frame.
 * Different label types respond best to different preprocessing approaches.
 *
 * @param  {HTMLCanvasElement} src  Source canvas (captured video frame)
 * @return {string[]}               Array of PNG data URLs
 */
function buildVariants(src) {
  const W = src.width, H = src.height;

  // Helper: create canvas, scale up, apply pixel transform, return PNG URL
  const make = (scale, fn) => {
    const c   = document.createElement('canvas');
    c.width   = Math.round(W * scale);
    c.height  = Math.round(H * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    if (fn) {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      fn(id.data);
      ctx.putImageData(id, 0, 0);
    }
    return c.toDataURL('image/png');
  };

  // ── Pixel transform functions ──────────────────────────────────────────────
  // Greyscale: standard luminance weights
  const grey = d => {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      d[i] = d[i+1] = d[i+2] = g;
      d[i+3] = 255;
    }
  };

  // High contrast: greyscale + contrast boost
  const contrast = lv => d => {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const f = (259 * (lv + 255)) / (255 * (259 - lv));
      const v = Math.min(255, Math.max(0, f * (g - 128) + 128));
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
  };

  // Sharpening: unsharp mask (greyscale → enhance edges)
  const sharpen = d => {
    // First greyscale
    grey(d);
    // Simple 3x3 sharpening kernel: centre=5, neighbours=-1
    // Applied as a pass on already-greyscale data (simplified inline)
    // For production: use a proper convolution — this approximates it
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    // (lightweight approximation via contrast boost after greyscale)
    contrast(60)(d);
  };

  // Binary threshold: pixels above t → white, below → black
  const thresh = t => d => {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const v = g > t ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
  };

  // Inverted threshold: white text on dark bg → dark text on white bg
  const invThresh = t => d => {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const v = g > t ? 0 : 255;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
  };

  return [
    make(3, grey),           // 1. Greyscale 3×           — clear printed labels
    make(3, contrast(80)),   // 2. High contrast 3×        — faded/old labels
    make(3, sharpen),        // 3. Sharpened 3×            — blurry captures
    make(3, thresh(150)),    // 4. Binary thresh 150       — dark text on light bg
    make(3, thresh(100)),    // 5. Binary thresh 100       — stamps on darker bg
    make(3, invThresh(120)), // 6. Inverted threshold 3×   — white text on dark bg
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
const STEPS = [
  { n:1, label:'Scan Barcode',   icon:'fa-barcode'      },
  { n:2, label:'Read Expiry',    icon:'fa-calendar-alt' },
  { n:3, label:'Confirm & Save', icon:'fa-check'        },
];

const StepIndicator = ({ step }) => (
  <div className="sc-steps">
    {STEPS.map(({ n, label, icon }, i) => (
      <React.Fragment key={n}>
        <div className={`sc-step ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}>
          <div className="sc-step-circle">
            {step > n
              ? <i className="fas fa-check"/>
              : <i className={`fas ${icon}`}/>}
          </div>
          <span>{label}</span>
        </div>
        {i < 2 && <div className={`sc-step-line ${step > n ? 'done' : ''}`}/>}
      </React.Fragment>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SCANNER COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const Scanner = ({ onProductScanned }) => {

  // ── UI ────────────────────────────────────────────────────────────────────
  const [step,          setStep]         = useState(0);
  const [scanning,      setScanning]     = useState(false);
  const [progress,      setProgress]     = useState('');
  const [progressType,  setProgressType] = useState('info'); // info|success|warn|error
  const [error,         setError]        = useState('');
  const [ocrRunning,    setOcrRunning]   = useState(false);
  const [saving,        setSaving]       = useState(false);

  // ── Product ───────────────────────────────────────────────────────────────
  const [productData,   setProductData]  = useState(null);
  const [capturedImg,   setCapturedImg]  = useState(null);
  const [ocrRawText,    setOcrRawText]   = useState('');

  // ── Expiry date — two separate states ─────────────────────────────────────
  //
  // expiryInput  The value shown in the <input type="text"> field.
  //              OCR sets this to the raw detected string (e.g. "EXP 29/01/26").
  //              User can also type or edit this freely.
  //
  // expiryISO    The validated YYYY-MM-DD string used internally for saving.
  //              Only non-empty when a valid future date has been confirmed.
  //              Gates the Save button — disabled until this is set.
  //
  const [expiryInput,   setExpiryInput]  = useState('');
  const [expiryISO,     setExpiryISO]    = useState('');

  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const codeReader = useRef(new BrowserMultiFormatReader());

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  const showMsg = (msg, type = 'info') => {
    setProgress(msg);
    setProgressType(type);
  };

  /**
   * Called on every keystroke in the expiry input field.
   * Runs the full extraction pipeline on the typed/edited value.
   * Sets expiryISO if a valid future date is recognised, clears it otherwise.
   */
  const handleExpiryType = val => {
    setExpiryInput(val);
    setExpiryISO(parseTypedDate(val) || '');
  };

  /**
   * Called by captureAndReadExpiry after OCR finds a date.
   * Sets both the display input value AND the internal ISO value.
   */
  const setExpiryFromOCR = (result) => {
    if (!result) {
      setExpiryInput('');
      setExpiryISO('');
      return;
    }
    // Show result.raw in the field — user sees exactly what OCR read
    // e.g. "BEST BEFORE 29/01/26" or "14 JAN 2026"
    setExpiryInput(result.raw);
    setExpiryISO(result.iso);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CAMERA
  // ─────────────────────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width:      { ideal: 1920 },
          height:     { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      return true;
    } catch {
      setError('Camera access denied. Please allow camera permission and try again.');
      return false;
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    try { codeReader.current.reset(); } catch {}
  };

  useEffect(() => () => stopCamera(), []);

  // ─────────────────────────────────────────────────────────────────────────
  // RESET
  // ─────────────────────────────────────────────────────────────────────────
  const reset = () => {
    stopCamera();
    setStep(0);        setProgress('');   setError('');
    setProductData(null); setCapturedImg(null); setOcrRawText('');
    setExpiryInput(''); setExpiryISO('');
    setOcrRunning(false); setSaving(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — BARCODE SCAN
  // ─────────────────────────────────────────────────────────────────────────
  const startBarcode = async () => {
    reset();
    setStep(1);
    showMsg('Opening camera…');
    if (!(await startCamera())) { setStep(0); return; }
    showMsg('Point camera at the barcode…');
    await new Promise(r => setTimeout(r, 500));
    codeReader.current.decodeFromVideoDevice(
      null,
      videoRef.current,
      async (result, err) => {
        if (result) {
          codeReader.current.reset();
          showMsg('Barcode detected — looking up product…');
          await fetchProduct(result.getText());
        }
        if (err && !(err instanceof NotFoundException)) console.warn(err.message);
      }
    );
  };

  const fetchProduct = async (barcode) => {
    try {
      const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const p = data.product;
        setProductData({
          barcode,
          name:     p.product_name || p.product_name_en || p.abbreviated_product_name || '',
          brand:    p.brands    || '',
          category: mapCategory(p.categories_tags),
          image:    p.image_front_url || p.image_url || null,
          quantity: p.quantity  || '',
        });
        showMsg('✅ Product found! Now scan the expiry date.', 'success');
      } else {
        setProductData({ barcode, name:'', brand:'', category:'Other', image:null, quantity:'' });
        showMsg('Product not in database — enter details manually.', 'warn');
      }
    } catch {
      setProductData({ barcode, name:'', brand:'', category:'Other', image:null, quantity:'' });
      showMsg('Could not fetch product info — enter manually.', 'warn');
    }
    stopCamera();
    setStep(2);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — OCR CAMERA
  // ─────────────────────────────────────────────────────────────────────────
  const startOCRCamera = async () => {
    setError('');
    showMsg('Opening camera…');
    if (!(await startCamera())) return;
    showMsg('Point camera at the expiry / best-before date on the package, then tap Capture.');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2b — CAPTURE + PREPROCESS + OCR + AUTO-FILL
  //
  // FULL PIPELINE:
  //   1. Capture video frame to canvas
  //   2. Build 6 preprocessed image variants
  //   3. For each variant, run Tesseract with PSM 7 → 6 → 11
  //      a. Try bounding-box word-level search (keyword proximity)
  //      b. Fallback to full-text extraction if bounding-box fails
  //   4. Stop as soon as a valid future date is found
  //   5. Auto-fill the expiry text input field
  // ─────────────────────────────────────────────────────────────────────────
  const captureAndReadExpiry = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setOcrRunning(true);
    showMsg('Capturing…');

    // ── 1. Capture frame ──────────────────────────────────────────────────
    const v = videoRef.current, c = canvasRef.current;
    c.width  = v.videoWidth  || 1280;
    c.height = v.videoHeight || 720;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    setCapturedImg(c.toDataURL('image/jpeg', 0.95));
    stopCamera();

    // ── 2. Build image variants ───────────────────────────────────────────
    showMsg('Enhancing image…');
    const variants = buildVariants(c);

    // ── 3. OCR loop ───────────────────────────────────────────────────────
    let ocrResult = null; // { iso, display, raw }
    let bestText  = '';   // longest OCR text seen (for display in UI)

    // PSM modes tried for each variant:
    //   7  = single text line (best when zoomed in on just the date)
    //   6  = uniform text block (good for full label shots)
    //   11 = sparse text (fallback for very messy/cluttered labels)
    const PSM_MODES = [7, 6, 11];

    const TESSERACT_CONFIG = {
      // Only characters that appear in dates — dramatically reduces noise
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/-.: ',
      preserve_interword_spaces: '1',
    };

    outer:
    for (let vi = 0; vi < variants.length; vi++) {
      showMsg(`Reading expiry date… (${vi + 1}/${variants.length})`);

      for (const psm of PSM_MODES) {
        try {
          const ocr = await Tesseract.recognize(variants[vi], 'eng', {
            ...TESSERACT_CONFIG,
            tessedit_pageseg_mode: psm,
          });

          const { text, words } = ocr.data;
          if (text.length > bestText.length) bestText = text;

          // ── 3a. Bounding-box word-level search (PRIMARY method) ─────────
          // Find expiry keyword → look at next 3–6 words only
          // Much more accurate than full-text search on labels with multiple dates
          if (words?.length > 0) {
            const boxResult = extractExpiryFromWords(words);
            if (boxResult) {
              ocrResult = boxResult;
              break outer;
            }
          }

          // ── 3b. Full-text extraction (FALLBACK method) ──────────────────
          // Used when bounding box search finds nothing
          const textResult = extractExpiryDate(text);
          if (textResult) {
            ocrResult = textResult;
            break outer;
          }

        } catch (e) {
          console.warn(`OCR variant ${vi + 1} PSM ${psm}:`, e.message);
        }
      }
    }

    setOcrRawText(bestText);

    // ── 4. AUTO-FILL THE EXPIRY INPUT FIELD ──────────────────────────────
    if (ocrResult) {
      // Shows the raw OCR line (e.g. "EXP 29/01/26") in the text field
      // so the user can immediately see what was read from the package
      setExpiryFromOCR(ocrResult);
      showMsg(`✅ Expiry date: ${ocrResult.display}`, 'success');
    } else {
      setExpiryInput('');
      setExpiryISO('');
      showMsg('⚠️ Could not read date automatically — please type it below.', 'warn');
    }

    setOcrRunning(false);
    setStep(3);
  };

  const skipToConfirm = () => {
    stopCamera();
    setStep(3);
    setProgress('');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — SAVE
  // ─────────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!productData || !expiryISO) return;
    setSaving(true);
    try {
      await onProductScanned({
        barcode:    productData.barcode,
        name:       productData.name     || `Product ${productData.barcode}`,
        brand:      productData.brand    || 'Unknown',
        category:   productData.category,
        image:      productData.image    || emoji(productData.category),
        expiryDate: expiryISO,           // always YYYY-MM-DD
        quantity:   productData.quantity || '',
      });
      reset();
    } catch {
      setError('Could not save product — please try again.');
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="sc-wrap">

      {/* ── STEP 0: Start screen ────────────────────────────────────────── */}
      {step === 0 && (
        <div className="sc-start">
          <div className="sc-start-icon"><i className="fas fa-barcode"/></div>
          <h2>Scan Product</h2>
          <p>Scan the barcode then point at the expiry date — we read it automatically.</p>
          <div className="sc-hiw">
            {[
              { n:'1', icon:'fa-barcode',      label:'Scan barcode'    },
              { n:'2', icon:'fa-eye',           label:'OCR reads expiry'},
              { n:'3', icon:'fa-check-circle',  label:'Confirm & save'  },
            ].map(s => (
              <div key={s.n} className="sc-hiw-step">
                <div className="sc-hiw-num">{s.n}</div>
                <i className={`fas ${s.icon}`}/>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <button className="sc-btn sc-btn--primary sc-btn--lg" onClick={startBarcode}>
            <i className="fas fa-camera"/> Start Scanning
          </button>
        </div>
      )}

      {/* ── STEPS 1–3 ───────────────────────────────────────────────────── */}
      {step > 0 && (
        <>
          <StepIndicator step={step}/>

          {/* Progress message */}
          {progress && (
            <div className={`sc-progress sc-progress--${progressType}`}>
              {progressType === 'success' && <i className="fas fa-check-circle"/>}
              {progressType === 'warn'    && <i className="fas fa-exclamation-triangle"/>}
              {progressType === 'error'   && <i className="fas fa-times-circle"/>}
              {progressType === 'info'    && <i className="fas fa-spinner fa-spin"/>}
              <span>{progress}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="sc-error">
              <i className="fas fa-times-circle"/> {error}
            </div>
          )}

          {/* ── STEP 1: Barcode ── */}
          {step === 1 && (
            <div className="sc-viewport-wrap">
              <div className="sc-viewport">
                <video ref={videoRef} className="sc-video" playsInline muted autoPlay/>
                <canvas ref={canvasRef} style={{ display: 'none' }}/>
                <div className="sc-overlay sc-overlay--barcode">
                  <div className="sc-barcode-box"/>
                  <p className="sc-overlay-hint">Centre barcode in the box — detected automatically</p>
                </div>
              </div>
              <button className="sc-btn sc-btn--ghost sc-mt" onClick={reset}>
                <i className="fas fa-times"/> Cancel
              </button>
            </div>
          )}

          {/* ── STEP 2: OCR ── */}
          {step === 2 && (
            <div className="sc-ocr-step">

              {/* Product preview */}
              {productData && (
                <div className="sc-product-card">
                  {productData.image
                    ? <img src={productData.image} alt="" className="sc-product-img"/>
                    : <div className="sc-product-emoji">{emoji(productData.category)}</div>
                  }
                  <div className="sc-product-details">
                    {productData.name
                      ? <><h4>{productData.name}</h4><p>{[productData.brand, productData.category].filter(Boolean).join(' · ')}</p></>
                      : <><h4 className="sc-not-found">Not in database</h4><p>Enter name manually in next step</p></>
                    }
                    <code>{productData.barcode}</code>
                  </div>
                </div>
              )}

              {/* Instruction */}
              <div className="sc-ocr-tip">
                <i className="fas fa-lightbulb"/>
                <div>
                  <strong>Now scan the expiry date</strong>
                  <p>Find "Best Before" or "Exp. Date" on the package. Keep it inside the blue box, then tap Capture.</p>
                </div>
              </div>

              {/* Camera viewport */}
              {scanning && (
                <div className="sc-viewport">
                  <video ref={videoRef} className="sc-video" playsInline muted autoPlay/>
                  <canvas ref={canvasRef} style={{ display: 'none' }}/>
                  <div className="sc-overlay sc-overlay--ocr">
                    <div className="sc-ocr-box"><span>Expiry Date</span></div>
                    <p className="sc-overlay-hint">Keep the date inside the box</p>
                  </div>
                </div>
              )}

              {/* Placeholder when camera not open */}
              {!scanning && !ocrRunning && (
                <div className="sc-ocr-placeholder">
                  <i className="fas fa-calendar-alt"/>
                  <p>Tap "Open Camera" to scan the expiry date</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="sc-ocr-actions">
                {!scanning && !ocrRunning && (
                  <button className="sc-btn sc-btn--primary" onClick={startOCRCamera}>
                    <i className="fas fa-camera"/> Open Camera
                  </button>
                )}
                {scanning && !ocrRunning && (
                  <button className="sc-btn sc-btn--capture" onClick={captureAndReadExpiry}>
                    <i className="fas fa-circle"/> Capture & Read Date
                  </button>
                )}
                {ocrRunning && (
                  <button className="sc-btn sc-btn--primary" disabled>
                    <i className="fas fa-spinner fa-spin"/> Reading…
                  </button>
                )}
                <button className="sc-btn sc-btn--ghost" onClick={skipToConfirm}>
                  <i className="fas fa-forward"/> Skip — Enter Manually
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Confirm & save ── */}
          {step === 3 && productData && (
            <div className="sc-confirm-step">
              <h3><i className="fas fa-clipboard-check"/> Review & Confirm</h3>

              {/* Captured image + raw OCR text for reference */}
              {capturedImg && (
                <div className="sc-captured">
                  <img src={capturedImg} alt="Captured label" className="sc-captured-img"/>
                  {ocrRawText && (
                    <div className="sc-ocr-raw">
                      <i className="fas fa-eye"/>
                      <span>OCR read: <em>{ocrRawText.replace(/\n/g, ' ').substring(0, 140)}</em></span>
                    </div>
                  )}
                </div>
              )}

              <div className="sc-form">

                {/* Product Name */}
                <div className="sc-field sc-field--full">
                  <label><i className="fas fa-tag"/> Product Name *</label>
                  <input
                    type="text"
                    value={productData.name}
                    onChange={e => setProductData({ ...productData, name: e.target.value })}
                    placeholder="Enter product name"
                  />
                </div>

                {/* Brand */}
                <div className="sc-field">
                  <label><i className="fas fa-building"/> Brand</label>
                  <input
                    type="text"
                    value={productData.brand}
                    onChange={e => setProductData({ ...productData, brand: e.target.value })}
                    placeholder="e.g. Amul, Nestle"
                  />
                </div>

                {/* Category */}
                <div className="sc-field">
                  <label><i className="fas fa-folder"/> Category</label>
                  <select
                    value={productData.category}
                    onChange={e => setProductData({ ...productData, category: e.target.value })}
                  >
                    {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/*
                  ── EXPIRY DATE FIELD ────────────────────────────────────────
                  This is the unique feature of FreshTrack.

                  STATE FLOW:
                    OCR finds date → setExpiryFromOCR(result)
                      → expiryInput = result.raw   (shown in field)
                      → expiryISO   = result.iso   (YYYY-MM-DD, used for saving)

                  USER TYPES:
                    handleExpiryType(val)
                      → expiryInput = val          (shown in field)
                      → expiryISO   = parseTypedDate(val) | ''

                  VISUAL STATES:
                    Green (is-valid)   = expiryISO is set (valid future date confirmed)
                    Red   (is-invalid) = user is typing but not yet recognised
                    Plain              = field is empty (OCR hasn't run or was skipped)
                */}
                <div className="sc-field sc-field--full">
                  <label>
                    <i className="fas fa-calendar-alt"/> Expiry Date *
                    {expiryISO && (
                      <span className="sc-ocr-badge">
                        <i className="fas fa-magic"/> OCR auto-filled
                      </span>
                    )}
                  </label>

                  <input
                    type="text"
                    value={expiryInput}
                    onChange={e => handleExpiryType(e.target.value)}
                    placeholder="OCR will auto-fill this · or type any date format"
                    className={[
                      'sc-expiry-input',
                      expiryISO                       ? 'is-valid'   : '',
                      expiryInput && !expiryISO       ? 'is-invalid' : '',
                    ].filter(Boolean).join(' ')}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />

                  {/* ✅ Confirmation row — shown when a valid date is parsed */}
                  {expiryISO && (
                    <div className="sc-expiry-confirm">
                      <i className="fas fa-check-circle"/>
                      <strong>{formatISO(expiryISO)}</strong>
                      <code>{expiryISO}</code>
                    </div>
                  )}

                  {/* ⚠️ Format not recognised */}
                  {expiryInput && !expiryISO && (
                    <p className="sc-expiry-hint sc-expiry-hint--error">
                      Format not recognised — try: 29/01/2026 · JAN 2026 · 29.01.26 · 2026-01-29
                    </p>
                  )}

                  {/* ℹ️ Empty state */}
                  {!expiryInput && (
                    <p className="sc-expiry-hint">
                      OCR auto-fills this after scanning · or type any date format
                    </p>
                  )}
                </div>

                {/* Quantity */}
                <div className="sc-field">
                  <label><i className="fas fa-weight"/> Quantity / Size</label>
                  <input
                    type="text"
                    value={productData.quantity}
                    onChange={e => setProductData({ ...productData, quantity: e.target.value })}
                    placeholder="e.g. 500ml, 1kg"
                  />
                </div>

              </div>

              {/* Actions */}
              <div className="sc-confirm-actions">
                <button className="sc-btn sc-btn--ghost" onClick={reset}>
                  <i className="fas fa-times"/> Cancel
                </button>
                <button
                  className="sc-btn sc-btn--primary"
                  onClick={handleSave}
                  disabled={!productData.name || !expiryISO || saving}
                >
                  {saving
                    ? <><i className="fas fa-spinner fa-spin"/> Saving…</>
                    : <><i className="fas fa-check"/> Add to Inventory</>
                  }
                </button>
              </div>

            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Scanner;
