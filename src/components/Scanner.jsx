import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import Tesseract from 'tesseract.js';
import './Scanner.css';

// ── Constants ────────────────────────────────────
const SCAN_MODES = {
  BARCODE: 'barcode',
  OCR: 'ocr',
};

const CATEGORY_EXPIRY_DAYS = {
  dairy: 7, meat: 3, produce: 5, bakery: 3,
  'canned goods': 365, beverages: 180, 'frozen foods': 90,
  snacks: 30, condiments: 180, other: 30,
};

// ── Helpers ──────────────────────────────────────
const calculateSuggestedExpiry = (category = 'other') => {
  const cat = category.toLowerCase();
  let days = 30;
  for (const [key, d] of Object.entries(CATEGORY_EXPIRY_DAYS)) {
    if (cat.includes(key)) { days = d; break; }
  }
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

const extractDateFromText = (text) => {
  if (!text) return null;
  const upper = text.toUpperCase().replace(/\s+/g, ' ');
  const patterns = [
    /(?:BEST\s*BEFORE|USE\s*BY|EXPIRY|EXPIRES?|BB|EXP\.?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:BEST\s*BEFORE|USE\s*BY|EXPIRY|EXPIRES?)\s*[:\-]?\s*(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{2,4})/i,
    /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/,
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
  ];
  for (const pattern of patterns) {
    const match = upper.match(pattern);
    if (match) {
      try {
        const date = new Date(match[1]);
        if (!isNaN(date.getTime())) {
          const today = new Date();
          const min = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
          const max = new Date(today.getFullYear() + 10, today.getMonth(), today.getDate());
          if (date >= min && date <= max) return date.toISOString().split('T')[0];
        }
      } catch (_) {}
    }
  }
  return null;
};

// ── Scanner Component ────────────────────────────
const Scanner = ({ onProductScanned }) => {
  const [mode, setMode] = useState(SCAN_MODES.BARCODE);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanStatus, setScanStatus] = useState(null); // 'progress' | 'success' | 'error'
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [productData, setProductData] = useState(null);
  const [expiryDate, setExpiryDate] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrDetected, setOcrDetected] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const codeReaderRef = useRef(new BrowserMultiFormatReader());

  // ── Camera ────────────────────────────────────
  const startCamera = useCallback(async () => {
    showProgress('Initializing camera…');
    if (!navigator.mediaDevices?.getUserMedia) {
      showError('Camera not supported in this browser');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (err) {
      const msg =
        err.name === 'NotAllowedError' ? 'Camera permission denied. Please allow camera access.' :
        err.name === 'NotFoundError' ? 'No camera found on this device.' :
        `Camera error: ${err.message}`;
      showError(msg);
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (codeReaderRef.current) codeReaderRef.current.reset();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // ── Status helpers ────────────────────────────
  const showProgress = (msg) => { setScanProgress(msg); setScanStatus('progress'); };
  const showSuccess = (msg) => { setScanProgress(msg); setScanStatus('success'); };
  const showError = (msg) => { setScanProgress(msg); setScanStatus('error'); };
  const clearStatus = () => { setScanProgress(''); setScanStatus(null); };

  // ── OpenFoodFacts API ─────────────────────────
  const fetchProduct = useCallback(async (barcode) => {
    showProgress('Looking up product in database…');
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const data = await res.json();
      if (data.status === 0) throw new Error('Product not found');
      const p = data.product;
      return {
        barcode,
        name: p.product_name || p.product_name_en || `Product ${barcode}`,
        category: p.categories_tags?.[0]?.split(':').pop().replace(/_/g, ' ') ?? 'Other',
        brand: p.brands || 'Unknown',
        image: p.image_url || null,
        ingredients: p.ingredients_text || '',
        quantity: p.quantity || '',
        allergens: p.allergens_tags?.map(t => t.split(':')[1]).join(', ') || '',
      };
    } catch {
      return { barcode, name: `Product ${barcode}`, category: 'Other', brand: 'Unknown', image: null };
    }
  }, []);

  // ── OCR ───────────────────────────────────────
  const captureAndOCR = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) throw new Error('Camera not available');
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < 2) {
      await new Promise(res => video.addEventListener('loadeddata', res, { once: true }));
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg', 0.9);

    showProgress('Reading text from image… 0%');
    setOcrLoading(true);
    try {
      const { data: { text } } = await Tesseract.recognize(imageData, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            showProgress(`Reading text from image… ${Math.round(m.progress * 100)}%`);
          }
        },
      });
      setOcrText(text);
      const date = extractDateFromText(text);
      if (date) {
        setExpiryDate(date);
        setOcrDetected(true);
        showSuccess(`Expiry date detected: ${new Date(date).toLocaleDateString()}`);
      } else {
        setOcrDetected(false);
        showProgress('No date found — please enter manually');
      }
      return date;
    } finally {
      setOcrLoading(false);
    }
  }, []);

  // ── Start Barcode Mode ────────────────────────
  const startBarcodeScanner = useCallback(async () => {
    setScanning(true);
    setShowConfirmation(false);
    setProductData(null);
    setOcrText('');
    setOcrDetected(false);
    clearStatus();

    const ok = await startCamera();
    if (!ok) { setScanning(false); return; }

    showProgress('Aim camera at barcode…');
    await new Promise(r => setTimeout(r, 500));

    codeReaderRef.current.decodeFromVideoDevice(null, videoRef.current, async (result, err) => {
      if (result) {
        const barcode = result.getText();
        codeReaderRef.current.reset();
        showProgress(`Barcode detected: ${barcode}`);

        // Try OCR at the same time
        let ocrDate = null;
        try { ocrDate = await captureAndOCR(); } catch (_) {}

        const product = await fetchProduct(barcode);
        setProductData(product);
        setExpiryDate(ocrDate || calculateSuggestedExpiry(product.category));
        setShowConfirmation(true);
        stopCamera();
        setScanning(false);
        showSuccess('Scan complete! Review details below.');
      }
      if (err && !(err instanceof NotFoundException)) {
        showError('Scan failed — try again or enter manually.');
      }
    });
  }, [startCamera, stopCamera, captureAndOCR, fetchProduct]);

  // ── Start OCR Mode ────────────────────────────
  const startOCRScanner = useCallback(async () => {
    setScanning(true);
    setShowConfirmation(false);
    setProductData(null);
    setOcrText('');
    setOcrDetected(false);
    clearStatus();

    const ok = await startCamera();
    if (!ok) { setScanning(false); return; }
    showProgress('Point camera at the expiry date label…');
  }, [startCamera]);

  // ── Capture OCR (button press in OCR mode) ────
  const handleCaptureOCR = useCallback(async () => {
    try {
      await captureAndOCR();
      // Show confirmation with just OCR (no barcode product)
      setProductData({
        barcode: '',
        name: 'Scanned Product',
        category: 'Other',
        brand: '',
        image: null,
      });
      setShowConfirmation(true);
      stopCamera();
      setScanning(false);
    } catch (err) {
      showError(`OCR failed: ${err.message}`);
    }
  }, [captureAndOCR, stopCamera]);

  // ── Stop ─────────────────────────────────────
  const handleStop = useCallback(() => {
    stopCamera();
    setScanning(false);
    clearStatus();
  }, [stopCamera]);

  // ── Manual barcode entry ──────────────────────
  const handleManualEntry = useCallback(async () => {
    const barcode = prompt('Enter barcode number:');
    if (!barcode?.trim()) return;
    showProgress('Looking up product…');
    setLoading(true);
    try {
      const product = await fetchProduct(barcode.trim());
      setProductData(product);
      setExpiryDate(calculateSuggestedExpiry(product.category));
      setOcrDetected(false);
      setShowConfirmation(true);
      clearStatus();
    } finally {
      setLoading(false);
    }
  }, [fetchProduct]);

  // ── Confirm add product ──────────────────────
  const handleConfirm = useCallback(() => {
    if (!productData || !expiryDate) return;
    const final = {
      id: `${productData.barcode || 'manual'}_${Date.now()}`,
      barcode: productData.barcode,
      name: productData.name,
      category: productData.category,
      image: productData.image || '📦',
      brand: productData.brand,
      expiryDate,
      scanDate: new Date().toISOString(),
      ingredients: productData.ingredients,
      quantity: productData.quantity,
      allergens: productData.allergens,
      ocrText,
    };
    onProductScanned(final);
    setShowConfirmation(false);
    setProductData(null);
    setOcrText('');
    setOcrDetected(false);
    showSuccess('✓ Product added successfully!');
    setTimeout(clearStatus, 3000);
  }, [productData, expiryDate, ocrText, onProductScanned]);

  const handleCancel = useCallback(() => {
    setShowConfirmation(false);
    setProductData(null);
    setOcrText('');
    setOcrDetected(false);
    clearStatus();
  }, []);

  // Mode switch stops any active scan
  const handleModeChange = (newMode) => {
    if (scanning) handleStop();
    setMode(newMode);
    clearStatus();
  };

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Render ────────────────────────────────────
  return (
    <div className="scanner-container">
      <h2><i className="fas fa-camera-retro"></i> Product Scanner</h2>
      <p>Choose a scanning mode — scan barcodes to look up products, or use OCR to read expiry dates directly from packaging.</p>

      {/* Mode Selector */}
      <div className="scanner-mode-tabs">
        <button
          className={`mode-tab ${mode === SCAN_MODES.BARCODE ? 'active' : ''}`}
          onClick={() => handleModeChange(SCAN_MODES.BARCODE)}
        >
          <div className="tab-icon"><i className="fas fa-barcode"></i></div>
          <div className="tab-text">
            <strong>Scan Barcode</strong>
            <span>Auto-fetch product info + expiry</span>
          </div>
        </button>
        <button
          className={`mode-tab ${mode === SCAN_MODES.OCR ? 'active' : ''}`}
          onClick={() => handleModeChange(SCAN_MODES.OCR)}
        >
          <div className="tab-icon"><i className="fas fa-eye"></i></div>
          <div className="tab-text">
            <strong>Read Expiry Date</strong>
            <span>OCR scan of date label</span>
          </div>
        </button>
      </div>

      {/* Status Messages */}
      {scanProgress && (
        <div className={
          scanStatus === 'success' ? 'scan-success' :
          scanStatus === 'error' ? 'error-message' : 'scan-progress'
        }>
          <i className={`fas fa-${
            scanStatus === 'success' ? 'check-circle' :
            scanStatus === 'error' ? 'exclamation-circle' :
            (loading || ocrLoading) ? 'spinner fa-spin' : 'circle-notch fa-spin'
          }`}></i>
          <span>{scanProgress}</span>
          {scanStatus === 'error' && (
            <button className="manual-input-btn" onClick={handleManualEntry}>Enter Manually</button>
          )}
        </div>
      )}

      {/* Viewport */}
      <div className="scanner-viewport">
        {scanning ? (
          <>
            <video ref={videoRef} className="scanner-video" playsInline muted />
            <canvas ref={canvasRef} className="hidden-canvas" />
            <div className="scanner-overlay">
              {mode === SCAN_MODES.BARCODE && (
                <div className="barcode-guide">
                  <div className="corner tl" />
                  <div className="corner tr" />
                  <div className="corner bl" />
                  <div className="corner br" />
                  <div className="scan-line" />
                </div>
              )}
              {mode === SCAN_MODES.OCR && (
                <div className="ocr-area">
                  <span className="ocr-label">Aim at expiry date text</span>
                </div>
              )}
              <div className="scan-hint">
                <i className={`fas fa-${mode === SCAN_MODES.BARCODE ? 'barcode' : 'font'}`}></i>
                {mode === SCAN_MODES.BARCODE
                  ? 'Hold barcode within the green frame'
                  : 'Position expiry date in the blue box, then press Capture'}
              </div>
              <div className="mode-badge">
                <i className={`fas fa-${mode === SCAN_MODES.BARCODE ? 'barcode' : 'eye'}`}></i>
                {mode === SCAN_MODES.BARCODE ? 'Barcode Mode' : 'OCR Mode'}
              </div>
            </div>
          </>
        ) : (
          <div className="scanner-placeholder">
            <div className={`placeholder-icon ${mode === SCAN_MODES.BARCODE ? 'barcode' : 'ocr'}`}>
              <i className={`fas fa-${mode === SCAN_MODES.BARCODE ? 'barcode' : 'eye'}`}></i>
            </div>
            <p>{mode === SCAN_MODES.BARCODE ? 'Barcode Scanner Ready' : 'OCR Expiry Reader Ready'}</p>
            <small>
              {mode === SCAN_MODES.BARCODE
                ? 'Automatically detects product info and reads expiry date using ZXing + Tesseract.js'
                : 'Point camera at any expiry date text on packaging — Tesseract.js will extract it'}
            </small>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="scanner-controls">
        {mode === SCAN_MODES.BARCODE && (
          <>
            <button
              className={`scan-btn ${scanning ? 'stop-btn' : 'start-btn'}`}
              onClick={scanning ? handleStop : startBarcodeScanner}
              disabled={loading || ocrLoading}
            >
              <i className={`fas fa-${scanning ? 'stop-circle' : 'barcode'}`}></i>
              {scanning ? 'Stop Scanner' : 'Start Barcode Scan'}
            </button>
            <button
              className="manual-btn"
              onClick={handleManualEntry}
              disabled={scanning || loading || ocrLoading}
            >
              <i className="fas fa-keyboard"></i>
              Enter Barcode Manually
            </button>
          </>
        )}

        {mode === SCAN_MODES.OCR && (
          <>
            <button
              className={`scan-btn ${scanning ? 'stop-btn' : 'start-btn'}`}
              onClick={scanning ? handleStop : startOCRScanner}
              disabled={ocrLoading}
            >
              <i className={`fas fa-${scanning ? 'stop-circle' : 'video'}`}></i>
              {scanning ? 'Stop Camera' : 'Start Camera'}
            </button>
            {scanning && (
              <button
                className="ocr-capture-btn"
                onClick={handleCaptureOCR}
                disabled={ocrLoading}
              >
                <i className={`fas fa-${ocrLoading ? 'spinner fa-spin' : 'camera'}`}></i>
                {ocrLoading ? 'Reading…' : 'Capture & Read Date'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && productData && (
        <div className="confirmation-modal-overlay" onClick={(e) => e.target === e.currentTarget && handleCancel()}>
          <div className="confirmation-modal">
            <div className="modal-header">
              <div className="modal-header-icon">
                <i className="fas fa-check"></i>
              </div>
              <h3>Review & Confirm Product</h3>
            </div>

            <div className="modal-body">
              <div className="info-grid">
                {productData.barcode && (
                  <div className="info-row">
                    <span className="info-row-label"><i className="fas fa-barcode"></i> Barcode</span>
                    <code className="info-row-value">{productData.barcode}</code>
                  </div>
                )}
                <div className="info-row">
                  <span className="info-row-label"><i className="fas fa-tag"></i> Product Name</span>
                  <span className="info-row-value">{productData.name}</span>
                </div>
                {productData.brand && (
                  <div className="info-row">
                    <span className="info-row-label"><i className="fas fa-building"></i> Brand</span>
                    <span className="info-row-value">{productData.brand}</span>
                  </div>
                )}
                <div className="info-row">
                  <span className="info-row-label"><i className="fas fa-folder"></i> Category</span>
                  <span className="category-badge">{productData.category}</span>
                </div>
              </div>

              {/* OCR / Expiry Section */}
              <div className="ocr-results">
                <div className="ocr-results-title">
                  <i className="fas fa-calendar-check"></i> Expiry Date
                </div>

                {ocrDetected ? (
                  <>
                    <div className="expiry-detected">
                      <strong><i className="fas fa-magic"></i> Auto-detected by OCR</strong>
                      <span className="expiry-date-display">
                        {new Date(expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    {ocrText && (
                      <div className="ocr-text-box">
                        <i className="fas fa-align-left"></i>
                        <span><strong>Raw OCR text:</strong> {ocrText.substring(0, 150)}{ocrText.length > 150 ? '…' : ''}</span>
                      </div>
                    )}
                    <div className="manual-expiry-input" style={{ marginTop: '1rem' }}>
                      <label><i className="fas fa-pencil-alt"></i> Adjust if needed:</label>
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        className="expiry-input"
                      />
                    </div>
                  </>
                ) : (
                  <div className="manual-expiry-input">
                    <label><i className="fas fa-calendar-alt"></i> Enter Expiry Date <span style={{ color: '#e53935' }}>*</span></label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="expiry-input"
                      required
                      min={new Date(new Date().getFullYear() - 1, 0, 1).toISOString().split('T')[0]}
                    />
                    {!ocrText && (
                      <small style={{ color: '#9e9e9e', fontSize: '.8rem', marginTop: '.375rem', display: 'block' }}>
                        OCR did not detect a date — please enter manually
                      </small>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={handleCancel}>
                <i className="fas fa-times"></i> Cancel
              </button>
              <button
                className="confirm-btn"
                onClick={handleConfirm}
                disabled={!expiryDate}
              >
                <i className="fas fa-plus"></i> Add to Inventory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Cards */}
      <div className="scanner-info">
        <h4><i className="fas fa-info-circle"></i> How It Works</h4>
        <div className="info-cards">
          <div className="info-card">
            <h5><i className="fas fa-barcode"></i> Barcode Scanner</h5>
            <ul>
              <li>Real-time ZXing detection</li>
              <li>Auto-fetches product from OpenFoodFacts</li>
              <li>Simultaneously reads expiry via OCR</li>
            </ul>
          </div>
          <div className="info-card">
            <h5><i className="fas fa-eye"></i> OCR Reader</h5>
            <ul>
              <li>Tesseract.js text recognition</li>
              <li>Smart date pattern matching</li>
              <li>Works on any packaging format</li>
            </ul>
          </div>
          <div className="info-card">
            <h5><i className="fas fa-database"></i> Product Data</h5>
            <ul>
              <li>OpenFoodFacts global database</li>
              <li>Millions of products indexed</li>
              <li>Manual fallback for unknown items</li>
            </ul>
          </div>
        </div>
        <div className="scanner-tips">
          <p>
            <strong>💡 Tips for best results:</strong>
            Ensure good lighting and hold the camera steady. For OCR, get close to the expiry date text.
            After a barcode scan, OCR also runs automatically — just review the detected date in the confirmation dialog.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Scanner;