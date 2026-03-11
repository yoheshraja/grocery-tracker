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
// ─────────────────────────────────────────────────────────────────────────────
// IMAGE PREPROCESSING — lazy, single variant at a time
// Returns a JPEG data URL ready for Tesseract.
// Scale 2× is enough — 3× adds pixels but not accuracy, and triples OCR time.
// ─────────────────────────────────────────────────────────────────────────────
function makeVariant(src, type) {
  const W = src.width, H = src.height;
  const SCALE = 2;
  const c = document.createElement('canvas');
  c.width  = W * SCALE;
  c.height = H * SCALE;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);

  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d  = id.data;

  if (type === 'grey') {
    // Greyscale + mild contrast boost — best for most printed labels
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const f = (259 * (80 + 255)) / (255 * (259 - 80));
      const v = Math.min(255, Math.max(0, f * (g - 128) + 128));
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
  } else if (type === 'thresh') {
    // Binary threshold 140 — black text on white bg (ink stamps, clear labels)
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const v = g > 140 ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
  } else if (type === 'inv') {
    // Inverted threshold — white text on dark background
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const v = g > 140 ? 0 : 255;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
  }
  // else 'raw' — no pixel transform, just 2× upscale

  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.92); // JPEG much faster than PNG
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

  // ── Crop UI ───────────────────────────────────────────────────────────────
  const [showCrop,  setShowCrop]  = useState(false);
  const [cropBox,   setCropBox]   = useState({ x: 0.05, y: 0.2, w: 0.9, h: 0.6 });
  const cropImgRef  = useRef(null);
  const dragState   = useRef(null);
  const cropBoxRef  = useRef({ x: 0.05, y: 0.2, w: 0.9, h: 0.6 }); // always mirrors cropBox state

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
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const streamRef     = useRef(null);
  const ocrTargetRef  = useRef(null);  // ref on the OCR box element for exact crop
  const codeReader    = useRef(new BrowserMultiFormatReader());
  const pendingMode   = useRef(null);

  // ─────────────────────────────────────────────────────────────────────────
  // KEY FIX: attach stream AFTER <video> mounts
  // When scanning flips true, React renders the <video> element.
  // Only after that render does videoRef.current exist in the DOM.
  // This effect runs after every render where scanning===true and
  // assigns the waiting stream to the video element.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    // Attach stream if not already attached
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(e => console.warn('video.play():', e));
    }

    // Start barcode decoding if that's what triggered the camera
    if (pendingMode.current === 'barcode') {
      pendingMode.current = null;
      setTimeout(() => {
        codeReader.current.decodeFromVideoDevice(
          null,
          video,
          async (result, err) => {
            if (result) {
              codeReader.current.reset();
              showMsg('Barcode detected — looking up product…');
              await fetchProduct(result.getText());
            }
            if (err && !(err instanceof NotFoundException)) {
              console.warn('Barcode:', err.message);
            }
          }
        );
      }, 300);
    }
  }, [scanning]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Show the clean formatted date in the field (e.g. "04 March 2030")
    // NOT the raw OCR line — that was confusing users
    setExpiryInput(result.display);
    setExpiryISO(result.iso);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CAMERA — rewritten to fix the black screen bug
  //
  // ROOT CAUSE of black screen:
  //   The old code did: get stream → assign to videoRef.current → setScanning(true)
  //   But for OCR step, <video> is conditionally rendered (only when scanning=true).
  //   So videoRef.current is NULL when we try to assign — the video never gets
  //   the stream, and the element renders empty (black).
  //
  // FIX:
  //   1. Get stream, store in streamRef (never touch videoRef here)
  //   2. Set pendingMode so the useEffect above knows what to do
  //   3. setScanning(true) → React renders <video> → useEffect fires →
  //      video is now in the DOM → attach stream → play
  // ─────────────────────────────────────────────────────────────────────────
  const startCamera = async (mode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:      { ideal: 1280 },
          height:     { ideal: 720 },
        },
      });
      streamRef.current = stream;
      pendingMode.current = mode; // 'barcode' or 'ocr'
      setScanning(true);          // renders <video> → useEffect fires → attaches stream
      return true;
    } catch (e) {
      console.error('Camera error:', e);
      setError('Camera access denied. Please allow camera permission and try again.');
      return false;
    }
  };

  const stopCamera = () => {
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // Detach from video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    // Reset ZXing reader
    try { codeReader.current.reset(); } catch {}
    pendingMode.current = null;
    setScanning(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RESET
  // ─────────────────────────────────────────────────────────────────────────
  const reset = () => {
    stopCamera();
    setStep(0);        setProgress('');   setError('');
    setProductData(null); setCapturedImg(null); setOcrRawText('');
    setExpiryInput(''); setExpiryISO('');
    setOcrRunning(false); setSaving(false);
    cropBoxRef.current = { x: 0.05, y: 0.2, w: 0.9, h: 0.6 };
    setShowCrop(false); setCropBox({ x: 0.05, y: 0.2, w: 0.9, h: 0.6 });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — BARCODE SCAN
  // ─────────────────────────────────────────────────────────────────────────
  const startBarcode = async () => {
    reset();
    setStep(1);
    showMsg('Opening camera…');
    // Pass 'barcode' mode — useEffect will start ZXing after video mounts
    if (!(await startCamera('barcode'))) { setStep(0); return; }
    showMsg('Point camera at the barcode…');
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
    // Pass 'ocr' mode — useEffect just attaches stream, no ZXing
    if (!(await startCamera('ocr'))) return;
    showMsg('Point camera at the expiry date, then tap Capture.');
  };

  // ── STEP 2b: Capture full frame → show crop UI ───────────────────────────
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v  = videoRef.current;
    const c  = canvasRef.current;
    const vw = v.videoWidth  || 1280;
    const vh = v.videoHeight || 720;
    c.width  = vw * 2;
    c.height = vh * 2;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(v, 0, 0, vw, vh, 0, 0, c.width, c.height);
    setCapturedImg(c.toDataURL('image/jpeg', 0.92));
    stopCamera();
    cropBoxRef.current = { x: 0.05, y: 0.2, w: 0.9, h: 0.6 };
    setCropBox({ x: 0.05, y: 0.2, w: 0.9, h: 0.6 });
    setShowCrop(true);
    showMsg('Drag the handles to surround the expiry date, then tap Read Date.');
  };

  // ── Crop drag logic ───────────────────────────────────────────────────────
  const onCropPointerDown = (e, handle) => {
    e.preventDefault();
    const cx0 = e.touches ? e.touches[0].clientX : e.clientX;
    const cy0 = e.touches ? e.touches[0].clientY : e.clientY;
    dragState.current = { handle, startX: cx0, startY: cy0, startBox: { ...cropBox } };

    const onMove = (ev) => {
      if (!dragState.current) return;
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const img = cropImgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const dx = (cx - dragState.current.startX) / rect.width;
      const dy = (cy - dragState.current.startY) / rect.height;
      const b  = dragState.current.startBox;
      let { x, y, w, h } = b;
      const MIN = 0.08;
      switch (dragState.current.handle) {
        case 'tl': x = Math.min(b.x+dx, b.x+b.w-MIN); y = Math.min(b.y+dy, b.y+b.h-MIN); w = b.w-(x-b.x); h = b.h-(y-b.y); break;
        case 'tr': w = Math.max(b.w+dx, MIN); y = Math.min(b.y+dy, b.y+b.h-MIN); h = b.h-(y-b.y); break;
        case 'bl': x = Math.min(b.x+dx, b.x+b.w-MIN); w = b.w-(x-b.x); h = Math.max(b.h+dy, MIN); break;
        case 'br': w = Math.max(b.w+dx, MIN); h = Math.max(b.h+dy, MIN); break;
        case 't':  y = Math.min(b.y+dy, b.y+b.h-MIN); h = b.h-(y-b.y); break;
        case 'b':  h = Math.max(b.h+dy, MIN); break;
        case 'l':  x = Math.min(b.x+dx, b.x+b.w-MIN); w = b.w-(x-b.x); break;
        case 'r':  w = Math.max(b.w+dx, MIN); break;
        case 'move': x = b.x+dx; y = b.y+dy; break;
        default: break;
      }
      x = Math.max(0, Math.min(x, 1-MIN));
      y = Math.max(0, Math.min(y, 1-MIN));
      w = Math.max(MIN, Math.min(w, 1-x));
      h = Math.max(MIN, Math.min(h, 1-y));
      cropBoxRef.current = { x, y, w, h };
      setCropBox({ x, y, w, h });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
  };

  // ── STEP 2c: OCR on cropped region ───────────────────────────────────────
  //
  // PIPELINE:
  //   1. Snapshot the cropBox fractions from the ref BEFORE any async work
  //   2. Load the full captured JPEG into a fresh offscreen Image
  //      → .naturalWidth / .naturalHeight give true pixel dimensions
  //   3. Map fractions → pixel coords on the natural image
  //   4. Draw the crop onto a fresh offscreen canvas (never reuse canvasRef
  //      here — it may be touched by React or other code between awaits)
  //   5. Upscale 2× for Tesseract if the crop is small
  //   6. Try grey → thresh → inv; stop on first date found
  //   7. Always go to step 3, show what OCR found (or let user type)
  // ─────────────────────────────────────────────────────────────────────────
  const runOCROnCrop = async () => {
    if (!capturedImg) return;

    // ── Snapshot the box NOW before any state changes ──
    const box = { ...cropBoxRef.current };

    setOcrRunning(true);
    setShowCrop(false);
    showMsg('Cropping…');

    try {
      // ── 1. Load full-resolution image from data URL ──────────────────────
      const fullImg = await new Promise((res, rej) => {
        const i = new Image();
        i.onload  = () => res(i);
        i.onerror = rej;
        i.src = capturedImg;   // the data URL saved by captureFrame()
      });

      // ── 2. Compute pixel crop on the NATURAL (full-res) image ────────────
      const natW = fullImg.naturalWidth  || fullImg.width;
      const natH = fullImg.naturalHeight || fullImg.height;

      const cropX = Math.round(natW * box.x);
      const cropY = Math.round(natH * box.y);
      const cropW = Math.max(20, Math.round(natW * box.w));
      const cropH = Math.max(20, Math.round(natH * box.h));

      // ── 3. Draw crop onto a fresh canvas — never reuse canvasRef ─────────
      // If the crop is very short (< 60px) upscale it to at least 120px
      // so Tesseract gets enough vertical pixels for the font.
      const MIN_OCR_H = 120;
      const upscale   = cropH < MIN_OCR_H ? Math.ceil(MIN_OCR_H / cropH) : 1;
      const outW      = cropW * upscale;
      const outH      = cropH * upscale;

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width  = outW;
      cropCanvas.height = outH;
      const ctx = cropCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(fullImg, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

      // Save cropped image for display in step 3
      const croppedDataUrl = cropCanvas.toDataURL('image/jpeg', 0.92);
      setCapturedImg(croppedDataUrl);

      // ── 4. OCR — PSM 7 for short crops, PSM 6 for taller blocks ─────────
      const psm = (box.h < 0.12) ? '7' : '6';
      const TESS_CONFIG = {
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/-.: ',
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: psm,
      };

      const ATTEMPTS = ['grey', 'thresh', 'inv'];
      let ocrResult = null;
      let bestText  = '';

      for (const type of ATTEMPTS) {
        showMsg(type === 'grey' ? 'Enhancing…' : 'Retrying…');
        try {
          const variant = makeVariant(cropCanvas, type);
          const ocr = await Tesseract.recognize(variant, 'eng', TESS_CONFIG);
          const { text, words } = ocr.data;
          if (text.trim().length > bestText.length) bestText = text.trim();
          if (words?.length) {
            const r = extractExpiryFromWords(words);
            if (r) { ocrResult = r; break; }
          }
          const r = extractExpiryDate(text);
          if (r) { ocrResult = r; break; }
        } catch (e) {
          console.warn('OCR', type, e.message);
        }
      }

      setOcrRawText(bestText);
      if (ocrResult) {
        setExpiryFromOCR(ocrResult);
        showMsg(`✅ Expiry date: ${ocrResult.display}`, 'success');
      } else {
        setExpiryInput('');
        setExpiryISO('');
        showMsg('⚠️ Could not read date — please type it below.', 'warn');
      }

    } catch (err) {
      console.error('runOCROnCrop error:', err);
      showMsg('⚠️ Could not process image — please type the date.', 'warn');
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

                {/* VIDEO — position:absolute fills the container */}
                <video ref={videoRef} className="sc-video" playsInline muted autoPlay/>
                <canvas ref={canvasRef} style={{ display: 'none' }}/>

                {/* LIVE badge — floats above video, no background blocking feed */}
                <div className="sc-live-badge">
                  <span className="sc-live-dot"/> LIVE
                </div>

                {/* Barcode overlay — position:absolute, NO background */}
                <div className="sc-barcode-overlay">
                  <div className="sc-barcode-target">
                    <span className="sc-target-label">Barcode</span>
                    <span className="sc-corner tl"/>
                    <span className="sc-corner tr"/>
                    <span className="sc-corner bl"/>
                    <span className="sc-corner br"/>
                    <span className="sc-scanline"/>
                  </div>
                </div>

                {/* Hint at bottom */}
                <div className="sc-viewport-hint">
                  Centre the barcode — scans automatically
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

              {/* ── A: Live camera ── */}
              {scanning && !showCrop && !ocrRunning && (
                <>
                  <div className="sc-ocr-tip">
                    <i className="fas fa-lightbulb"/>
                    <div>
                      <strong>Point at the expiry date label</strong>
                      <p>Hold steady, then tap Capture. You can crop after.</p>
                    </div>
                  </div>
                  <div className="sc-viewport">
                    <video ref={videoRef} className="sc-video" playsInline muted autoPlay/>
                    <canvas ref={canvasRef} style={{ display: 'none' }}/>
                    <div className="sc-live-badge"><span className="sc-live-dot"/> LIVE</div>
                    <div className="sc-viewport-hint">Aim at the expiry date</div>
                  </div>
                  <div className="sc-ocr-actions">
                    <button className="sc-btn sc-btn--capture" onClick={captureFrame}>
                      <i className="fas fa-camera"/> Capture
                    </button>
                    <button className="sc-btn sc-btn--ghost" onClick={skipToConfirm}>
                      <i className="fas fa-forward"/> Skip — Enter Manually
                    </button>
                  </div>
                </>
              )}

              {/* ── B: Crop UI ── */}
              {showCrop && !ocrRunning && (
                <>
                  <div className="sc-ocr-tip sc-ocr-tip--blue">
                    <i className="fas fa-crop-alt"/>
                    <div>
                      <strong>Crop to the expiry date</strong>
                      <p>Drag handles to tightly frame the date, then tap Read Date.</p>
                    </div>
                  </div>

                  <div className="sc-crop-wrap">
                    <img ref={cropImgRef} src={capturedImg} alt="Captured" className="sc-crop-img" draggable={false}/>

                    {/* Dark overlay + crop border via SVG */}
                    <svg className="sc-crop-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
                      <defs>
                        <mask id="cropMask">
                          <rect width="1" height="1" fill="white"/>
                          <rect x={cropBox.x} y={cropBox.y} width={cropBox.w} height={cropBox.h} fill="black"/>
                        </mask>
                      </defs>
                      <rect width="1" height="1" fill="rgba(0,0,0,0.6)" mask="url(#cropMask)"/>
                      <rect x={cropBox.x} y={cropBox.y} width={cropBox.w} height={cropBox.h} fill="none" stroke="#4ade80" strokeWidth="0.004"/>
                      <line x1={cropBox.x+cropBox.w/3}   y1={cropBox.y} x2={cropBox.x+cropBox.w/3}   y2={cropBox.y+cropBox.h} stroke="rgba(255,255,255,0.25)" strokeWidth="0.002"/>
                      <line x1={cropBox.x+cropBox.w*2/3} y1={cropBox.y} x2={cropBox.x+cropBox.w*2/3} y2={cropBox.y+cropBox.h} stroke="rgba(255,255,255,0.25)" strokeWidth="0.002"/>
                      <line x1={cropBox.x} y1={cropBox.y+cropBox.h/3}   x2={cropBox.x+cropBox.w} y2={cropBox.y+cropBox.h/3}   stroke="rgba(255,255,255,0.25)" strokeWidth="0.002"/>
                      <line x1={cropBox.x} y1={cropBox.y+cropBox.h*2/3} x2={cropBox.x+cropBox.w} y2={cropBox.y+cropBox.h*2/3} stroke="rgba(255,255,255,0.25)" strokeWidth="0.002"/>
                    </svg>

                    {/* Move entire box (inner drag area) */}
                    <div className="sc-crop-move" style={{ left:`${cropBox.x*100}%`, top:`${cropBox.y*100}%`, width:`${cropBox.w*100}%`, height:`${cropBox.h*100}%` }}
                      onMouseDown={e=>onCropPointerDown(e,'move')} onTouchStart={e=>onCropPointerDown(e,'move')}/>

                    {/* 4 corner handles */}
                    {[['tl',0,0],['tr',1,0],['bl',0,1],['br',1,1]].map(([h,fx,fy])=>(
                      <div key={h} className={`sc-crop-handle sc-crop-h-${h}`}
                        style={{ left:`${(cropBox.x+cropBox.w*fx)*100}%`, top:`${(cropBox.y+cropBox.h*fy)*100}%` }}
                        onMouseDown={e=>onCropPointerDown(e,h)} onTouchStart={e=>onCropPointerDown(e,h)}/>
                    ))}

                    {/* 4 edge handles */}
                    {[['t',0.5,0],['b',0.5,1],['l',0,0.5],['r',1,0.5]].map(([h,fx,fy])=>(
                      <div key={h} className={`sc-crop-handle sc-crop-h-edge sc-crop-h-${h}`}
                        style={{ left:`${(cropBox.x+cropBox.w*fx)*100}%`, top:`${(cropBox.y+cropBox.h*fy)*100}%` }}
                        onMouseDown={e=>onCropPointerDown(e,h)} onTouchStart={e=>onCropPointerDown(e,h)}/>
                    ))}
                  </div>

                  <div className="sc-ocr-actions">
                    <button className="sc-btn sc-btn--primary" onClick={runOCROnCrop}>
                      <i className="fas fa-search"/> Read Date
                    </button>
                    <button className="sc-btn sc-btn--ghost" onClick={()=>{ setShowCrop(false); startOCRCamera(); }}>
                      <i className="fas fa-redo"/> Retake
                    </button>
                    <button className="sc-btn sc-btn--ghost" onClick={skipToConfirm}>
                      <i className="fas fa-forward"/> Skip — Enter Manually
                    </button>
                  </div>
                </>
              )}

              {/* ── C: OCR running ── */}
              {ocrRunning && (
                <div className="sc-ocr-placeholder">
                  <i className="fas fa-spinner fa-spin" style={{color:'#4a7c59',fontSize:'2.5rem'}}/>
                  <p>Reading expiry date…</p>
                </div>
              )}

              {/* ── D: Idle ── */}
              {!scanning && !showCrop && !ocrRunning && (
                <>
                  <div className="sc-ocr-tip">
                    <i className="fas fa-lightbulb"/>
                    <div>
                      <strong>Now scan the expiry date</strong>
                      <p>Open camera, capture the label, then crop tightly around the date.</p>
                    </div>
                  </div>
                  <div className="sc-ocr-placeholder">
                    <i className="fas fa-calendar-alt"/>
                    <p>Tap "Open Camera" to start</p>
                  </div>
                  <div className="sc-ocr-actions">
                    <button className="sc-btn sc-btn--primary" onClick={startOCRCamera}>
                      <i className="fas fa-camera"/> Open Camera
                    </button>
                    <button className="sc-btn sc-btn--ghost" onClick={skipToConfirm}>
                      <i className="fas fa-forward"/> Skip — Enter Manually
                    </button>
                  </div>
                </>
              )}

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
