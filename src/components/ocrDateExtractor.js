/**
 * ocrDateExtractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-ready pipeline to extract expiry dates from noisy OCR output.
 *
 * PIPELINE OVERVIEW:
 *   Step 1 → cleanOCRText()         Fix character noise & OCR mistakes
 *   Step 2 → fixExpiryKeywords()    Repair garbled keywords (USE 8) → USE BY)
 *   Step 3 → classifyLines()        Split into lines, tag expiry vs MFD lines
 *   Step 4 → findByBoundingBox()    Smart keyword-proximity search on word data
 *   Step 5 → extractFromText()      Run date regex patterns against text
 *   Step 6 → scoreAndPick()         Score candidates, return best future date
 *
 * EXPORTS:
 *   extractExpiryDate(rawText)        → { iso, display, raw } | null
 *   extractExpiryFromWords(words)     → { iso, display, raw } | null  (bounding box)
 *   parseTypedDate(val)               → 'YYYY-MM-DD' | null
 *   formatISO(iso)                    → '29 January 2026'
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = {
  JAN: 1, JANUARY: 1,
  FEB: 2, FEBRUARY: 2,
  MAR: 3, MARCH: 3,
  APR: 4, APRIL: 4,
  MAY: 5,
  JUN: 6, JUNE: 6,
  JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBER: 10,
  NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12,
};

// Month name regex fragment — embedded into larger patterns
const MRE =
  'JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY' +
  '|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?' +
  '|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?';

// Keywords that identify expiry date lines
const EXP_KEYWORD_RE =
  /\b(BEST\s*BEFORE|USE\s*BY|USE\s*BEFORE|EXPIRY(?:\s*DATE)?|EXPIRES?|EXP(?:\s*DATE)?|BB|CONSUME\s*BY|SELL\s*BY)\b/;

// Keywords that identify manufacture / packaging date lines — to SKIP
const MFD_KEYWORD_RE =
  /\b(MFD(?:\s*DATE)?|MFG(?:\s*DATE)?|MANUFACTURED|DOM|DATE\s*OF\s*(?:MFG|PKG|PACKAGING|MANUFACTURE)|PACKED\s*ON|PKD)\b/;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — CLEAN OCR TEXT
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Removes noise symbols and fixes common OCR character confusion.
 *
 * CRITICAL RULE for character fixes:
 *   Only fix characters that sit BETWEEN two digits.
 *   This prevents corrupting month names: JAN → J1N, OCT → 0CT etc.
 *
 * @param  {string} raw  Raw text from Tesseract
 * @return {string}      Cleaned uppercase text
 */
export function cleanOCRText(raw) {
  if (!raw || typeof raw !== 'string') return '';

  return raw
    .toUpperCase()

    // ── Remove symbols that never appear in dates ──────────────────────────
    .replace(/[©®™°•·~§£€¥@#%^&*_+=[\]{}<>?!'"\\|]/g, ' ')

    // ── Fix digit/letter OCR confusion ────────────────────────────────────
    // ONLY applied when the character sits between two digit characters.
    // Lookbehind (?<=\d) and lookahead (?=\d) ensure we never touch letters
    // that are part of month names or other words.
    .replace(/(?<=\d)[OQ](?=\d)/g, '0')   // 2O26  → 2026
    .replace(/(?<=\d)[Il](?=\d)/g, '1')   // 2I26  → 2126
    .replace(/(?<=\d)S(?=\d)/g,    '5')   // 3S06  → 3506
    .replace(/(?<=\d)Z(?=\d)/g,    '2')   // 2Z26  → 2226
    .replace(/(?<=\d)G(?=\d)/g,    '6')   // 2G26  → 2626
    .replace(/(?<=\d)B(?=\d)/g,    '8')   // 2B26  → 2826

    // ── Normalise separators ───────────────────────────────────────────────
    .replace(/(\d)[,;](\d)/g,       '$1/$2')   // 12,2026 → 12/2026
    .replace(/(\d)\s{0,2}-\s{0,2}(\d)/g, '$1-$2') // "12 - 2026" → "12-2026"

    // ── Collapse whitespace ────────────────────────────────────────────────
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — FIX NOISY EXPIRY KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * OCR frequently garbles expiry keywords. This function repairs them before
 * keyword-based line classification and bounding-box search.
 *
 * Common real-world examples:
 *   "USE 8)"    → "USE BY"
 *   "B3ST BEFOR3" → "BEST BEFORE"
 *   "EXP1RY"    → "EXPIRY"
 *   "E.X.P."    → "EXP"
 *
 * @param  {string} text  Cleaned OCR text
 * @return {string}       Text with keywords repaired
 */
export function fixExpiryKeywords(text) {
  return text
    // USE BY variants
    .replace(/USE\s+[B8][Y)]/g,              'USE BY')
    .replace(/USE\s+8\)/g,                   'USE BY')

    // BEST BEFORE variants
    .replace(/B[E3]ST\s+B[E3]F[O0]R[E3]/g,  'BEST BEFORE')
    .replace(/BEST\s+BEF[O0]RE/g,            'BEST BEFORE')

    // EXPIRY / EXPIRES
    .replace(/EXP[1I]R[YV]/g,               'EXPIRY')
    .replace(/EXP[1I]RES?/g,                'EXPIRES')
    .replace(/EXPIRY\s+DATE?\.?/g,          'EXPIRY DATE')
    .replace(/EXP\.?\s*DATE?\.?/g,          'EXP DATE')

    // Standalone EXP with punctuation
    .replace(/\bE\.X\.P\.?\b/g,             'EXP')
    .replace(/\bEXP\.\b/g,                  'EXP')

    // BB shorthand
    .replace(/\bB\.B\.?\b/g,                'BB')
    .replace(/\bBB\.\b/g,                   'BB')

    // Manufacture date markers (so we can skip these lines)
    .replace(/\bMFG\.?\s*DATE?\.?\b/g,      'MFD DATE')
    .replace(/\bM\.?F\.?G\.?\b/g,           'MFG')
    .replace(/\bM\.?F\.?D\.?\b/g,           'MFD')
    .replace(/\bDATE\s+OF\s+MFG\b/g,        'MFD DATE')
    .replace(/\bDATE\s+OF\s+PKG\b/g,        'MFD DATE')
    .replace(/\bPACKED\s+ON\b/g,            'MFD DATE')
    .replace(/\bDOM\b/g,                    'MFD DATE');
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — BUILD AND VALIDATE A DATE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Converts date parts into a validated YYYY-MM-DD string.
 *
 * Validation rules:
 *   - Year must be 2025–2040 (realistic expiry range for food)
 *   - 2-digit years: only 25–39 accepted (→ 2025–2039); rejects "21" (2021, past)
 *   - Month: 1–12
 *   - Day: 1–31 (calendar-correct via Date object)
 *   - Date must be TODAY or in the future (past = manufacture date)
 *
 * @param  {number|string} yyyy  Year
 * @param  {number|string} mm    Month (1-based)
 * @param  {number|string} dd    Day (default 1 for month-only formats)
 * @return {string|null}         'YYYY-MM-DD' or null
 */
function toISO(yyyy, mm, dd = 1) {
  let y = parseInt(yyyy, 10);
  let m = parseInt(mm,   10);
  let d = parseInt(dd,   10);

  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

  // Expand 2-digit year
  if (y < 100) {
    if (y >= 25 && y <= 39) y += 2000;
    else return null; // e.g. "21" → 2021 (past) — reject
  }

  // Range checks
  if (y < 2025 || y > 2040) return null;
  if (m < 1    || m > 12)   return null;
  if (d < 1    || d > 31)   return null;

  // Create date (catches invalid days like Feb 31)
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;

  // Must be today or future — past dates are manufacture/packaging dates
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return null;

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Look up a month name → number */
function monthNum(name) {
  return MONTHS[name?.toUpperCase().replace(/\.$/, '')] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — DATE PATTERN LIBRARY
// ─────────────────────────────────────────────────────────────────────────────
/**
 * All supported date formats, ordered most-specific → least-specific.
 * The first pattern to return a valid future date wins (for a given line).
 *
 * Each entry:
 *   label  — human name (for debugging)
 *   re     — regex (applied with .match())
 *   parse  — converts regex match groups → ISO string via toISO()
 */
const DATE_PATTERNS = [

  // ── DD/MM/YYYY · DD-MM-YYYY · DD.MM.YYYY ────────────────────────────────
  // Examples: 08/01/2026  |  29-01-2026  |  31.12.2025
  {
    label: 'DD/MM/YYYY',
    re:    /\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](20[2-9]\d)\b/,
    parse: m => toISO(m[3], m[2], m[1]),
  },

  // ── YYYY-MM-DD (ISO) ─────────────────────────────────────────────────────
  // Example: 2026-01-08
  {
    label: 'YYYY-MM-DD',
    re:    /\b(20[2-9]\d)[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])\b/,
    parse: m => toISO(m[1], m[2], m[3]),
  },

  // ── DD MON YYYY (18 JAN 2026) ────────────────────────────────────────────
  {
    label: 'DD MON YYYY',
    re:    new RegExp(
      `\\b(0?[1-9]|[12]\\d|3[01])[\\s\\-\\/\\.](${MRE})[\\s\\-\\/\\.](20[2-9]\\d)\\b`,
      'i'
    ),
    parse: m => toISO(m[3], monthNum(m[2]), m[1]),
  },

  // ── MON YYYY (JAN 2026 · JAN-2026) ──────────────────────────────────────
  {
    label: 'MON YYYY',
    re:    new RegExp(`\\b(${MRE})[\\s\\-\\/\\.](20[2-9]\\d)\\b`, 'i'),
    parse: m => toISO(m[2], monthNum(m[1]), 1),
  },

  // ── YYYY MON (2026-JAN) ──────────────────────────────────────────────────
  {
    label: 'YYYY MON',
    re:    new RegExp(`\\b(20[2-9]\\d)[\\s\\-\\/\\.](${MRE})\\b`, 'i'),
    parse: m => toISO(m[1], monthNum(m[2]), 1),
  },

  // ── MM/YYYY (01/2026 · 01-2026) ─────────────────────────────────────────
  {
    label: 'MM/YYYY',
    re:    /\b(0?[1-9]|1[0-2])[\/\-](20[2-9]\d)\b/,
    parse: m => toISO(m[2], m[1], 1),
  },

  // ── DD/MM/YY two-digit year (29/01/26) ───────────────────────────────────
  {
    label: 'DD/MM/YY',
    re:    /\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.]([2-9]\d)\b/,
    parse: m => toISO(m[3], m[2], m[1]),
  },

  // ── MMYYYY no separator (012026 — ink stamp) ─────────────────────────────
  {
    label: 'MMYYYY',
    re:    /\b(0[1-9]|1[0-2])(20[2-9]\d)\b/,
    parse: m => toISO(m[2], m[1], 1),
  },

  // ── DDMMYYYY no separator (29012026) ────────────────────────────────────
  {
    label: 'DDMMYYYY',
    re:    /\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20[2-9]\d)\b/,
    parse: m => toISO(m[3], m[2], m[1]),
  },
];

/**
 * Run all date patterns against a single string.
 * Returns the first valid future ISO date found.
 */
function extractFromText(text) {
  for (const { re, parse } of DATE_PATTERNS) {
    const match = text.match(re);
    if (match) {
      const iso = parse(match);
      if (iso) return iso;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — BOUNDING-BOX KEYWORD PROXIMITY SEARCH
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Smart expiry detection using Tesseract word-level bounding box data.
 *
 * WHY THIS IS BETTER THAN FULL-TEXT SEARCH:
 *   Labels often have multiple dates: manufacture date + expiry date.
 *   Searching full text blindly can pick the wrong one.
 *   By finding the expiry KEYWORD first, then only looking at the
 *   3–6 words immediately following it, we extract the correct date
 *   with much higher accuracy.
 *
 * @param  {Array} words  Tesseract word-level data:
 *                        [{ text, bbox: { x0,y0,x1,y1 } }, ...]
 * @return {{ iso, display, raw } | null}
 */
export function extractExpiryFromWords(words) {
  if (!Array.isArray(words) || words.length === 0) return null;

  // Normalise all word texts
  const normalised = words.map((w, idx) => ({
    idx,
    text:    fixExpiryKeywords(cleanOCRText(w.text || '')),
    bbox:    w.bbox,
    original: w.text,
  }));

  // EXP keyword pattern to identify trigger words
  const EXP_WORD_RE =
    /^(BEST|BEFORE|USE|BY|EXPIRY|EXPIRES?|EXP|BB|CONSUME|SELL)$/;
  const MFD_WORD_RE =
    /^(MFD|MFG|MFG|MANUFACTURED|DOM|PACKED|PKD)$/;

  const candidates = [];

  for (let i = 0; i < normalised.length; i++) {
    const word = normalised[i];

    // Skip manufacture date keywords entirely
    if (MFD_WORD_RE.test(word.text)) continue;

    // Found a potential expiry keyword
    if (EXP_WORD_RE.test(word.text) || EXP_KEYWORD_RE.test(word.text)) {

      // Gather the next 3–6 words after the keyword
      const windowEnd  = Math.min(i + 7, normalised.length);
      const nextWords  = normalised.slice(i + 1, windowEnd);

      // Skip if next words contain a manufacture marker
      const hasMFD = nextWords.some(w => MFD_WORD_RE.test(w.text));
      if (hasMFD) continue;

      // Combine keyword + nearby words into a local search region
      const region = [word, ...nextWords].map(w => w.text).join(' ');

      // Try to extract date from this local region
      const iso = extractFromText(region);
      if (iso) {
        candidates.push({
          iso,
          raw:       region,
          score:     scoreDate(iso, true), // labelled = high confidence
          method:    'bounding-box',
        });
      } else {
        // Date might be split across words — try sliding window combinations
        for (let j = i + 1; j < windowEnd - 1; j++) {
          const combo = normalised.slice(j, Math.min(j + 4, windowEnd))
            .map(w => w.text).join(' ');
          const isoCombo = extractFromText(combo);
          if (isoCombo) {
            candidates.push({
              iso:    isoCombo,
              raw:    combo,
              score:  scoreDate(isoCombo, true),
              method: 'bounding-box-combo',
            });
            break;
          }
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return { iso: best.iso, display: formatISO(best.iso), raw: best.raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — SCORE CANDIDATES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Scores a date candidate. Higher score = more likely to be the expiry date.
 *
 * Scoring logic:
 *   +10000  if found on a labelled expiry line (has EXP / USE BY keyword)
 *   +500    if 30 days – 5 years ahead (typical food expiry window)
 *   +100    if less than 30 days (imminent expiry)
 *   +50     if more than 5 years (long shelf life — canned goods)
 *   +days   tie-break: prefer the further-future date
 *
 * WHY "choose latest valid future date":
 *   When two future dates exist unlabelled, the manufacture date is always
 *   the earlier one. Choosing the later date gives us the expiry date.
 */
function scoreDate(iso, isExpiryLine) {
  const days  = (new Date(iso) - new Date()) / 86400000;
  let   score = isExpiryLine ? 10000 : 0;
  if      (days >= 30  && days <= 1825) score += 500;
  else if (days >  0   && days <  30)   score += 100;
  else if (days >  1825)                score += 50;
  return score + days; // tie-break: further date wins
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — extractExpiryDate()
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Full pipeline: clean → fix → classify → extract → score → return best.
 * Use this when you only have raw OCR text (no bounding box data).
 * For bounding box data use extractExpiryFromWords() instead.
 *
 * @param  {string} rawOCRText  Raw text output from Tesseract
 * @return {{ iso: string, display: string, raw: string } | null}
 *
 *   iso     → "2026-01-29"       Save this to the database
 *   display → "29 January 2026"  Show this to the user
 *   raw     → "EXP 29/01/26"     The OCR line where date was found
 */
export function extractExpiryDate(rawOCRText) {
  if (!rawOCRText || typeof rawOCRText !== 'string') return null;

  // ── 1. Clean and fix ──────────────────────────────────────────────────────
  const cleaned = fixExpiryKeywords(cleanOCRText(rawOCRText));

  // ── 2. Split into lines ───────────────────────────────────────────────────
  // Treat newlines, pipes, and semicolons as line separators
  const lines = cleaned
    .split(/[\n\r|;]/)
    .map(l => l.trim())
    .filter(Boolean);

  const candidates = [];

  // ── 3a. Pass 1: check each line individually ──────────────────────────────
  // Skips manufacture lines entirely.
  // Gives expiry-labelled lines a 10000-point score bonus.
  for (const line of lines) {
    if (MFD_KEYWORD_RE.test(line)) continue; // manufacture date — skip entirely

    const iso = extractFromText(line);
    if (iso) {
      candidates.push({
        iso,
        raw:   line,
        score: scoreDate(iso, EXP_KEYWORD_RE.test(line)),
      });
    }
  }

  // ── 3b. Pass 2: full-text fallback ───────────────────────────────────────
  // If no date found on individual lines, join all non-MFD lines and try the
  // combined block. This catches dates split across a line break.
  if (candidates.length === 0) {
    const block = lines
      .filter(l => !MFD_KEYWORD_RE.test(l))
      .join(' ');
    const iso = extractFromText(block);
    if (iso) {
      candidates.push({
        iso,
        raw:   block,
        score: scoreDate(iso, EXP_KEYWORD_RE.test(block)),
      });
    }
  }

  if (candidates.length === 0) return null;

  // ── 4. Pick highest-scored candidate ─────────────────────────────────────
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  return {
    iso:     best.iso,
    display: formatISO(best.iso),
    raw:     best.raw.trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format YYYY-MM-DD → "29 January 2026"
 * Used for display in the UI confirmation row.
 */
export function formatISO(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

/**
 * Parse any user-typed date string into YYYY-MM-DD.
 * Called on every keystroke in the expiry input field.
 * Supports all formats: "JAN 2026", "29/01/26", "2026-01-29", etc.
 *
 * @param  {string} val  User-typed value
 * @return {string|null} 'YYYY-MM-DD' or null
 */
export function parseTypedDate(val) {
  if (!val?.trim()) return null;

  // Try full extraction pipeline first
  const result = extractExpiryDate(val);
  if (result) return result.iso;

  // Fallback: native Date parse for standard formats like "2026-06-01"
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d >= today) return d.toISOString().split('T')[0];
  }

  return null;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * EDGE CASE HANDLING REFERENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * | OCR Input                     | After Fix            | Result         |
 * |-------------------------------|----------------------|----------------|
 * | "USE 8) 29/01/26"             | "USE BY 29/01/26"    | 2026-01-29 ✅  |
 * | "EXP.29.01.26"                | dots as separators   | 2026-01-29 ✅  |
 * | "Exp. Date © 14 JAN 2026"     | © stripped           | 2026-01-14 ✅  |
 * | "MFD 20.01.26 EXP 29.01.26"   | MFD line skipped     | 2026-01-29 ✅  |
 * | "DEC-21"                      | 21 < 25, rejected    | null ✅        |
 * | "JAN-2026, USE BY DEC-21"     | DEC-21 rejected      | 2026-01-01 ✅  |
 * | "2O26" (O not zero)           | digit-O-digit → 0    | 2026-xx-xx ✅  |
 * | "Garbage text no date"        | no match             | null ✅        |
 * | "29012026" (no separator)     | DDMMYYYY pattern     | 2026-01-29 ✅  |
 * | Date split "29/01" + " 2026"  | bounding-box combo   | 2026-01-29 ✅  |
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEST PRACTICE SUGGESTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. ALWAYS use bounding-box mode (extractExpiryFromWords) when Tesseract
 *    word-level data is available — it is significantly more accurate than
 *    full-text search because it narrows the search to the keyword vicinity.
 *
 * 2. Use multiple PSM modes: PSM 7 (single line) works best when the user
 *    zooms in on just the date. PSM 6 (block) for wider label shots.
 *
 * 3. Preprocess images before OCR: 3× upscale + greyscale + contrast boost
 *    dramatically improves accuracy on stamped/dot-matrix text.
 *
 * 4. Show result.raw in the input field, not a formatted version.
 *    The user can instantly verify the raw OCR string matches the package.
 *
 * 5. Never disable the input field after OCR. Always allow manual correction.
 *
 * 6. Log OCR raw text + parsed result in development for debugging.
 */
