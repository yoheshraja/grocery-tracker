// expiryDateExtractor.js
/**
 * Production-ready expiry date extractor from OCR text
 * Features:
 * - Handles multiple date formats
 * - OCR noise reduction
 * - Label-based detection (EXP, BEST BEFORE, etc.)
 * - Future date validation
 * - Score-based candidate selection
 * - MFD (manufacturing date) exclusion
 */

class ExpiryDateExtractor {
  constructor() {
    // Month name to number mapping
    this.monthMap = {
      'JAN': 1, 'JANUARY': 1,
      'FEB': 2, 'FEBRUARY': 2,
      'MAR': 3, 'MARCH': 3,
      'APR': 4, 'APRIL': 4,
      'MAY': 5,
      'JUN': 6, 'JUNE': 6,
      'JUL': 7, 'JULY': 7,
      'AUG': 8, 'AUGUST': 8,
      'SEP': 9, 'SEPT': 9, 'SEPTEMBER': 9,
      'OCT': 10, 'OCTOBER': 10,
      'NOV': 11, 'NOVEMBER': 11,
      'DEC': 12, 'DECEMBER': 12
    };

    // Keywords that indicate expiry dates
    this.expiryLabels = [
      'EXPIRY', 'EXP', 'EXPIRES', 'EXPIRE', 'EXPDT',
      'USE BY', 'USE BEFORE', 'BEST BEFORE', 'BEST BY',
      'BB', 'B.B', 'CONSUME BY', 'CONSUME BEFORE',
      'SELL BY', 'SELL BEFORE', 'USE BY', 'USE BEFORE',
      'EXPIRATION', 'EXP DATE', 'EXPIRY DATE'
    ].map(label => label.replace(/\s+/g, '\\s*')); // Allow flexible spaces

    // Keywords that indicate manufacturing dates (to exclude)
    this.mfgLabels = [
      'MFG', 'MFD', 'MANUFACTURED', 'DOM', 'DATE OF MFG',
      'DATE OF MANUFACTURE', 'PACKED ON', 'PKD ON',
      'PRODUCTION DATE', 'PROD DATE'
    ].map(label => label.replace(/\s+/g, '\\s*'));

    // Valid year range (adjust based on your needs)
    this.minYear = new Date().getFullYear();
    this.maxYear = this.minYear + 10; // Accept up to 10 years in future
    
    // Date patterns in order of preference
    this.datePatterns = this.initializePatterns();
  }

  initializePatterns() {
    const monthRegex = '(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';
    const separator = '[\\s\\-\\/\\.]';
    const yearRegex = '(?:20[2-9]\\d|2[4-9]|[3-9]\\d)'; // 2024-2099 or 2-digit 24-99

    return {
      // Format: DD/MM/YYYY or DD-MM-YYYY
      dmy: new RegExp(`(\\d{1,2})${separator}(\\d{1,2})${separator}(${yearRegex})`, 'g'),
      
      // Format: YYYY-MM-DD (ISO)
      ymd: new RegExp(`(${yearRegex})${separator}(\\d{1,2})${separator}(\\d{1,2})`, 'g'),
      
      // Format: DD MON YYYY (e.g., 15 JAN 2026)
      dMy: new RegExp(`(\\d{1,2})${separator}(${monthRegex})${separator}(${yearRegex})`, 'gi'),
      
      // Format: MON YYYY (e.g., JAN 2026)
      my: new RegExp(`(${monthRegex})${separator}(${yearRegex})`, 'gi'),
      
      // Format: YYYY MON (e.g., 2026 JAN)
      yM: new RegExp(`(${yearRegex})${separator}(${monthRegex})`, 'gi'),
      
      // Format: MM/YYYY (e.g., 01/2026)
      myNumeric: new RegExp(`(\\d{1,2})${separator}(${yearRegex})`, 'g'),
      
      // Format: DD/MM/YY (2-digit year)
      dmy2: new RegExp(`(\\d{1,2})${separator}(\\d{1,2})${separator}(\\d{2})`, 'g'),
      
      // Format: MMYYYY (no separator, e.g., 012026)
      mmyyyy: new RegExp(`(0[1-9]|1[0-2])(20[2-9]\\d)`, 'g'),
      
      // Format: DD MON (with implied current year) - handle carefully
      dm: new RegExp(`(\\d{1,2})${separator}(${monthRegex})`, 'gi')
    };
  }

  /**
   * Clean OCR text by fixing common OCR errors
   */
  cleanOCRText(rawText) {
    if (!rawText) return '';
    
    return rawText
      .toUpperCase()
      // Remove noise characters
      .replace(/[©®™°•·|_]/g, ' ')
      // Fix common OCR digit mistakes
      .replace(/(\d)O(\d)/g, '$10$2')  // O -> 0 between digits
      .replace(/(\d)I(\d)/g, '$11$2')  // I -> 1 between digits
      .replace(/(\d)l(\d)/g, '$11$2')  // l -> 1 between digits
      .replace(/(\d)S(\d)/g, '$15$2')  // S -> 5 between digits
      .replace(/(\d)Z(\d)/g, '$12$2')  // Z -> 2 between digits
      // Fix common punctuation mistakes
      .replace(/(\d)[,;](\d)/g, '$1/$2') // , or ; -> /
      .replace(/\s+/g, ' ')              // Normalize spaces
      .trim();
  }

  /**
   * Check if text contains expiry-related keywords
   */
  hasExpiryLabel(text, position) {
    const context = text.substring(Math.max(0, position - 30), position + 30);
    return this.expiryLabels.some(label => 
      new RegExp(label, 'i').test(context)
    );
  }

  /**
   * Check if text contains manufacturing date keywords (to exclude)
   */
  hasMfgLabel(text, position) {
    const context = text.substring(Math.max(0, position - 20), position + 20);
    return this.mfgLabels.some(label => 
      new RegExp(label, 'i').test(context)
    );
  }

  /**
   * Convert 2-digit year to 4-digit year
   */
  normalizeYear(year) {
    const yearNum = parseInt(year);
    if (yearNum > 100) return yearNum;
    
    const currentYear = new Date().getFullYear();
    const century = Math.floor(currentYear / 100) * 100;
    
    // Assume years 00-39 are 2000-2039, 40-99 are 1940-1999
    if (yearNum >= 0 && yearNum <= 39) {
      return century + yearNum;
    } else if (yearNum >= 40 && yearNum <= 99) {
      return century - 100 + yearNum;
    }
    return yearNum;
  }

  /**
   * Validate and build date string
   */
  buildDate(year, month, day = 1) {
    let y = this.normalizeYear(year);
    let m = parseInt(month);
    let d = parseInt(day);

    // Basic validation
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    
    // Year range validation
    if (y < this.minYear || y > this.maxYear) return null;

    // Create date and validate
    const date = new Date(y, m - 1, d);
    if (isNaN(date.getTime())) return null;
    
    // Check if date is valid (e.g., not 31st November)
    if (date.getFullYear() !== y || 
        date.getMonth() !== m - 1 || 
        date.getDate() !== d) {
      return null;
    }

    // For expiry dates, must be today or in future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return null;

    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Score a date candidate (higher = more likely to be correct expiry)
   */
  scoreCandidate(dateStr, hasLabel, position, text) {
    if (!dateStr) return -1;
    
    const date = new Date(dateStr);
    const today = new Date();
    const daysUntil = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    
    let score = 0;
    
    // Strong bonus for explicit expiry label
    if (hasLabel) score += 10000;
    
    // Penalize if near manufacturing labels
    if (this.hasMfgLabel(text, position)) score -= 5000;
    
    // Prefer dates in typical expiry range (30 days to 5 years)
    if (daysUntil >= 30 && daysUntil <= 1825) score += 500;
    else if (daysUntil > 0 && daysUntil < 30) score += 200; // Soon expiry
    else if (daysUntil > 1825) score += 100; // Long expiry
    
    // Prefer dates with explicit day (more precise)
    if (dateStr.length === 10) score += 100; // YYYY-MM-DD format
    
    return score;
  }

  /**
   * Extract all possible date candidates from text
   */
  extractCandidates(text) {
    const candidates = [];
    const cleaned = this.cleanOCRText(text);

    // Helper to add candidate
    const addCandidate = (dateStr, pattern, match) => {
      if (!dateStr) return;
      
      const hasLabel = this.hasExpiryLabel(cleaned, match.index);
      const score = this.scoreCandidate(dateStr, hasLabel, match.index, cleaned);
      
      if (score >= 0) {
        candidates.push({
          dateStr,
          score,
          hasLabel,
          matchIndex: match.index,
          matchedText: match[0]
        });
      }
    };

    // Try each pattern
    for (const [patternName, pattern] of Object.entries(this.datePatterns)) {
      const matches = cleaned.matchAll(pattern);
      
      for (const match of matches) {
        switch (patternName) {
          case 'dmy':
            addCandidate(this.buildDate(match[3], match[2], match[1]), patternName, match);
            break;
          case 'ymd':
            addCandidate(this.buildDate(match[1], match[2], match[3]), patternName, match);
            break;
          case 'dMy':
            const monthNum = this.monthMap[match[2].replace(/\.$/, '')];
            if (monthNum) {
              addCandidate(this.buildDate(match[3], monthNum, match[1]), patternName, match);
            }
            break;
          case 'my':
            const monthMy = this.monthMap[match[1].replace(/\.$/, '')];
            if (monthMy) {
              addCandidate(this.buildDate(match[2], monthMy, 1), patternName, match);
            }
            break;
          case 'yM':
            const monthYM = this.monthMap[match[2].replace(/\.$/, '')];
            if (monthYM) {
              addCandidate(this.buildDate(match[1], monthYM, 1), patternName, match);
            }
            break;
          case 'myNumeric':
            addCandidate(this.buildDate(match[2], match[1], 1), patternName, match);
            break;
          case 'dmy2':
            addCandidate(this.buildDate(match[3], match[2], match[1]), patternName, match);
            break;
          case 'mmyyyy':
            addCandidate(this.buildDate(match[2], match[1], 1), patternName, match);
            break;
          case 'dm':
            // For DM pattern, use current year if date is in future
            const monthDm = this.monthMap[match[2].replace(/\.$/, '')];
            if (monthDm) {
              const currentYear = new Date().getFullYear();
              const dateStr = this.buildDate(currentYear, monthDm, match[1]);
              if (dateStr && new Date(dateStr) >= new Date()) {
                addCandidate(dateStr, patternName, match);
              }
            }
            break;
        }
      }
    }

    return candidates;
  }

  /**
   * Main method: extract expiry date from OCR text
   * @param {string} ocrText - Raw OCR text
   * @returns {Object} Result with date and metadata
   */
  extractExpiryDate(ocrText) {
    if (!ocrText || typeof ocrText !== 'string') {
      return {
        success: false,
        date: null,
        error: 'Invalid input text'
      };
    }

    try {
      const candidates = this.extractCandidates(ocrText);
      
      if (candidates.length === 0) {
        return {
          success: false,
          date: null,
          error: 'No valid expiry date found'
        };
      }

      // Sort by score (highest first)
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      // Extract the raw date snippet for display
      const rawSnippet = this.extractRawSnippet(ocrText, best.matchedText);

      return {
        success: true,
        date: best.dateStr,
        rawSnippet: rawSnippet || best.matchedText,
        confidence: best.score > 10000 ? 'high' : best.score > 500 ? 'medium' : 'low',
        hasExplicitLabel: best.hasLabel,
        allCandidates: candidates.slice(0, 3) // Top 3 for debugging
      };
    } catch (error) {
      console.error('Date extraction error:', error);
      return {
        success: false,
        date: null,
        error: 'Extraction failed: ' + error.message
      };
    }
  }

  /**
   * Extract the raw date string from original text
   */
  extractRawSnippet(originalText, matchedText) {
    if (!originalText || !matchedText) return null;
    
    // Find the exact match in original text (case insensitive)
    const index = originalText.toUpperCase().indexOf(matchedText.toUpperCase());
    if (index >= 0) {
      return originalText.substring(index, index + matchedText.length);
    }
    
    return matchedText;
  }

  /**
   * Validate if a date string is a valid expiry
   */
  isValidExpiry(dateStr) {
    if (!dateStr) return false;
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return date >= today;
  }
}

// Export singleton instance
export default new ExpiryDateExtractor();
