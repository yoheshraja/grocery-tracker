/**
 * Scanner.jsx — FreshTrack
 * ─────────────────────────────────────────────────────────────────────────────
 * CROP FIX:
 *   The core issue was object-fit:contain adding letterbox bars — the SVG
 *   overlay covered the full container including bars, but crop fractions were
 *   calculated against the image itself. Fixed by:
 *     1. Storing native video aspect ratio
 *     2. Using object-fit:fill on the crop <img> so container = image (no bars)
 *     3. Container height = auto, driven by the image's natural ratio
 *     4. All handle positions map 1:1 to image fractions → pixel-perfect crop
 *
 * GOOGLE CALENDAR:
 *   After save, offer "Add to Google Calendar" button that opens Google Calendar
 *   with pre-filled event (1-day-before alarm) via a URL link.
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import Tesseract from 'tesseract.js';
import './Scanner.css';
// ─── Inlined OCR date extractor (v2 — all formats + recently-expired fix) ────
const MONTHS = {
  JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,
  JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,AUGUST:8,
  SEP:9,SEPT:9,SEPTEMBER:9,OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12,
};
const MRE='JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?';

// FIX 1: Accept dates up to 60 days in the past (recently-expired products
//         still need to be recorded; strict "future only" was rejecting valid OCR reads)
// FIX 2: Accept years from 2024 (not 2025) to handle Dec 2024 labels still in use
function toISO(yyyy,mm,dd=1){
  let y=parseInt(yyyy,10),m=parseInt(mm,10),d=parseInt(dd,10);
  if(isNaN(y)||isNaN(m)||isNaN(d))return null;
  // 2-digit year: 24-39 → 2024-2039
  if(y<100){if(y>=24&&y<=39)y+=2000;else return null;}
  if(y<2024||y>2040||m<1||m>12||d<1||d>31)return null;
  const dt=new Date(y,m-1,d);
  if(isNaN(dt.getTime()))return null;
  // Allow up to 60 days in the past — rejects manufacture dates (years old)
  // but accepts recently-expired labels a user is scanning to log
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-60); cutoff.setHours(0,0,0,0);
  if(dt<cutoff)return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function monthNum(n){return MONTHS[(n||'').toUpperCase().replace(/\.$/,'')]||null;}

// FIX 3: 12 patterns covering every real-world expiry label format
const DATE_PATTERNS=[
  // 1. DD/MM/YYYY  DD.MM.YYYY  DD-MM-YYYY  (most common Indian label)
  {re:/\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](20[2-9]\d)\b/,    parse:m=>toISO(m[3],m[2],m[1])},
  // 2. YYYY-MM-DD  YYYY/MM/DD  YYYY.MM.DD  (ISO-style)
  {re:/\b(20[2-9]\d)[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])\b/,    parse:m=>toISO(m[1],m[2],m[3])},
  // 3. DD MMM YYYY  (26 MAR 2026, 26-MAR-2026, 26/MAR/26)
  {re:new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])[\\s\\-\\/\\.](${MRE})[\\s\\-\\/\\.](20[2-9]\\d)\\b`,'i'), parse:m=>toISO(m[3],monthNum(m[2]),m[1])},
  // 4. MMM YYYY  (MAR 2026, MAR-2026, MAR.2026)
  {re:new RegExp(`\\b(${MRE})[\\s\\-\\/\\.](20[2-9]\\d)\\b`,'i'),                  parse:m=>toISO(m[2],monthNum(m[1]),1)},
  // 5. YYYY MMM  (2026-MAR, 2026 MAR)
  {re:new RegExp(`\\b(20[2-9]\\d)[\\s\\-\\/\\.](${MRE})\\b`,'i'),                  parse:m=>toISO(m[1],monthNum(m[2]),1)},
  // 6. MM/YYYY  MM-YYYY  (03/2026 — slash/dash only, NOT dot to avoid 03.26 false match)
  {re:/\b(0?[1-9]|1[0-2])[\/\-](20[2-9]\d)\b/,                                     parse:m=>toISO(m[2],m[1],1)},
  // 7. MM.YYYY  (03.2026 — dot variant, requires zero-padded month to be safe)
  {re:/\b(0[1-9]|1[0-2])\.(20[2-9]\d)\b/,                                           parse:m=>toISO(m[2],m[1],1)},
  // 8. DD/MM/YY  DD.MM.YY  DD-MM-YY  2-digit year  (11.03.26 — THE FAILING CASE)
  {re:/\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.]([2-9]\d)\b/,      parse:m=>toISO(m[3],m[2],m[1])},
  // 9. DD MM YYYY  space-separated  (26 03 2026)
  {re:/\b(0?[1-9]|[12]\d|3[01])\s+(0?[1-9]|1[0-2])\s+(20[2-9]\d)\b/,              parse:m=>toISO(m[3],m[2],m[1])},
  // 10. MMYYYY  no separator  (032026 ink stamp)
  {re:/\b(0[1-9]|1[0-2])(20[2-9]\d)\b/,                                             parse:m=>toISO(m[2],m[1],1)},
  // 11. DDMMYYYY  no separator  (26032026)
  {re:/\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20[2-9]\d)\b/,                       parse:m=>toISO(m[3],m[2],m[1])},
  // 12. DDMMYY  no separator  (260326 ink stamp)
  {re:/\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])([2-9]\d)\b/,                         parse:m=>toISO(m[3],m[2],m[1])},
];

function extractFromText(text){
  // Use matchAll so multiple dates on one line (e.g. "MFD 01.01.2026 EXP 26.03.2026")
  // all get tried — the first match may be the MFD date (too old), second is the expiry.
  for(const{re,parse}of DATE_PATTERNS){
    const flags=re.flags.includes('g')?re.flags:re.flags+'g';
    const all=[...text.matchAll(new RegExp(re.source,flags))];
    for(const m of all){const iso=parse(m);if(iso)return iso;}
  }
  return null;
}

function cleanOCRText(raw){
  if(!raw||typeof raw!=='string')return'';
  let t=raw.toUpperCase();
  // Remove noise symbols
  t=t.replace(/[©®™°•·~§£€¥@#%^&*_+=\[\]{}<>?!'"\\|]/g,' ');

  // ── Multi-letter groups FIRST (before single-letter fixes consume them) ───
  // "LL","LI","IL","II" between separators/spaces → "11" (e.g. month "11" read as "LL")
  if(/[\d\/\-\.\s]/.test(t)){
    t=t.replace(/(?<=[\s\/\-\.])([LI]{2})(?=[\s\/\-\.]|$)/g,(_,m)=>m.replace(/[LI]/g,'1'));
    t=t.replace(/^([LI]{2})(?=[\s\/\-\.])/g,(_,m)=>m.replace(/[LI]/g,'1'));
  }

  // ── Single letter fixes adjacent to digit ───────────────────────────────
  t=t.replace(/[LI](?=\d)/g,'1').replace(/(?<=\d)[LI]/g,'1');   // L7→17, 7L→71
  t=t.replace(/[OQ](?=\d)/g,'0').replace(/(?<=\d)[OQ]/g,'0');   // O→0
  t=t.replace(/S(?=\d)/g,'5').replace(/(?<=\d)S/g,'5');          // S→5
  t=t.replace(/Z(?=\d)/g,'2').replace(/(?<=\d)Z/g,'2');          // Z→2
  t=t.replace(/G(?=\d)/g,'6').replace(/(?<=\d)G/g,'6');          // G→6
  t=t.replace(/B(?=\d)/g,'8').replace(/(?<=\d)B/g,'8');          // B→8

  // ── Single letter fixes adjacent to separator / - . ─────────────────────
  t=t.replace(/[LI](?=[\/\-\.])/g,'1').replace(/(?<=[\/\-\.])[LI]/g,'1');
  t=t.replace(/[OQ](?=[\/\-\.])/g,'0').replace(/(?<=[\/\-\.])[OQ]/g,'0');
  t=t.replace(/G(?=[\/\-\.])/g,'6').replace(/(?<=[\/\-\.])G/g,'6');

  // ── Standalone single letter between whitespace (needs digit/sep context) ─
  if(/[\d\/\-\.]/.test(t)){
    t=t.replace(/(?<=[\s\/\-\.])([LI])(?=[\s\/\-\.]|$)/g,'1');
    t=t.replace(/^([LI])(?=[\s\/\-\.])/g,'1');
  }

  // ── Between-digit fixes (legacy — kept as safety net) ───────────────────
  t=t.replace(/(\d)[OQ](\d)/g,'$10$2').replace(/(\d)[Il](\d)/g,'$11$2');
  t=t.replace(/(\d)S(\d)/g,'$15$2').replace(/(\d)Z(\d)/g,'$12$2');

  // ── Separator normalisation ──────────────────────────────────────────────
  t=t.replace(/(\d)[,;](\d)/g,'$1/$2');
  t=t.replace(/(\d)\s{0,2}-\s{0,2}(\d)/g,'$1-$2');
  return t.replace(/\s+/g,' ').trim();
}

function fixKeywords(text){
  return text
    .replace(/USE\s+[B8][Y)]/g,'USE BY').replace(/B[E3]ST\s+B[E3]F[O0]R[E3]/g,'BEST BEFORE')
    .replace(/EXP[1I]R[YV]/g,'EXPIRY').replace(/\bE\.X\.P\.?\b/g,'EXP')
    .replace(/\bEXP\.\b/g,'EXP').replace(/\bB\.B\.?\b/g,'BB')
    .replace(/\bMFG?\.?\s*DATE?\.?\b/g,'MFD').replace(/\bDATE\s+OF\s+MFG\b/g,'MFD')
    .replace(/\bDATE\s+OF\s+PKG\b/g,'MFD').replace(/\bPACKED\s+ON\b/g,'MFD');
}

const EXP_RE=/\b(BEST\s*BEFORE|USE\s*BY|USE\s*BEFORE|EXPIRY(?:\s*DATE)?|EXPIRES?|EXP(?:\s*DATE)?|BB|CONSUME\s*BY|SELL\s*BY)\b/;
const MFD_RE=/\b(MFD(?:\s*DATE)?|MFG(?:\s*DATE)?|MANUFACTURED|DOM|DATE\s*OF\s*(?:MFG|PKG|PACKAGING|MANUFACTURE)|PACKED\s*ON|PKD)\b/;

function scoreDate(iso,labelled){
  const days=(new Date(iso)-new Date())/86400000;
  let s=labelled?10000:0;
  // Prefer dates in the near future; slightly past dates still acceptable
  if(days>=0&&days<=1825)s+=500;
  else if(days>1825)s+=50;
  else if(days>=-60)s+=200; // recently expired: higher than unlabelled future
  return s+days;
}

export function extractExpiryDate(rawText){
  if(!rawText||typeof rawText!=='string')return null;
  const cleaned=fixKeywords(cleanOCRText(rawText));
  const lines=cleaned.split(/[\n\r|;]/).map(l=>l.trim()).filter(Boolean);
  const candidates=[];

  const tryLine=(line,labelled)=>{
    const iso=extractFromText(line);
    if(iso){candidates.push({iso,raw:line,score:scoreDate(iso,labelled)});return true;}
    // Compact variant: remove spaces around separators & between adjacent digits
    // Handles OCR inserting spaces inside dates: "17 / 12 / 26" → "17/12/26"
    const c1=line.replace(/\s*([\\/\-.])\s*/g,'$1');
    const c2=line.replace(/(\d)\s+(\d)/g,'$1$2').replace(/\s*([\\/\-.])\s*/g,'$1');
    for(const v of [c1,c2]){
      if(v===line)continue;
      const iso2=extractFromText(v);
      if(iso2){candidates.push({iso:iso2,raw:line,score:scoreDate(iso2,labelled)});return true;}
    }
    return false;
  };

  for(const line of lines){
    if(MFD_RE.test(line)&&!EXP_RE.test(line))continue;
    tryLine(line, EXP_RE.test(line));
  }
  if(!candidates.length){
    const block=lines.filter(l=>!(MFD_RE.test(l)&&!EXP_RE.test(l))).join(' ');
    tryLine(block, EXP_RE.test(block));
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  return{iso:best.iso,display:formatISO(best.iso),raw:best.raw.trim()};
}

export function extractExpiryFromWords(words){
  if(!Array.isArray(words)||!words.length)return null;
  const EXP_WORD=/^(BEST|BEFORE|USE|BY|EXPIRY|EXPIRES?|EXP|BB|CONSUME|SELL)$/;
  const MFD_WORD=/^(MFD|MFG|MANUFACTURED|DOM|PACKED|PKD)$/;
  const norm=words.map((w,i)=>({i,text:fixKeywords(cleanOCRText(w.text||'')),original:w.text}));
  const candidates=[];
  for(let i=0;i<norm.length;i++){
    const w=norm[i];
    if(MFD_WORD.test(w.text))continue;
    if(EXP_WORD.test(w.text)||EXP_RE.test(w.text)){
      const end=Math.min(i+7,norm.length);
      const nxt=norm.slice(i+1,end);
      if(nxt.some(x=>MFD_WORD.test(x.text)))continue;
      const region=[w,...nxt].map(x=>x.text).join(' ');
      const iso=extractFromText(region);
      if(iso){candidates.push({iso,raw:region,score:scoreDate(iso,true)});continue;}
      for(let j=i+1;j<end-1;j++){
        const combo=norm.slice(j,Math.min(j+4,end)).map(x=>x.text).join(' ');
        const isoC=extractFromText(combo);
        if(isoC){candidates.push({iso:isoC,raw:combo,score:scoreDate(isoC,true)});break;}
      }
    }
  }
  // FIX 5: If keyword-based search found nothing, scan ALL words for any date
  // (handles labels where there's no explicit keyword, just a bare date)
  if(!candidates.length){
    const allText=norm.map(w=>w.text).join(' ');
    const iso=extractFromText(allText);
    if(iso)candidates.push({iso,raw:allText,score:scoreDate(iso,false)});
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  return{iso:best.iso,display:formatISO(best.iso),raw:best.raw};
}

export function formatISO(iso){
  if(!iso)return'';
  return new Date(iso+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
}

// FIX 6: parseTypedDate also accepts recently-expired dates (user typing manually)
// and handles more free-form inputs like "march 2026", "3/26" etc.
export function parseTypedDate(val){
  if(!val?.trim())return null;
  const result=extractExpiryDate(val);
  if(result)return result.iso;
  // Native Date parse fallback (handles "2026-03-11", "March 11 2026" etc.)
  const d=new Date(val);
  if(!isNaN(d.getTime())){
    const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-60);
    if(d>=cutoff)return d.toISOString().split('T')[0];
  }
  return null;
}

// ─── Category mapping ────────────────────────────────────────────────────────
const CATEGORY_RULES = [
  { cat:'Dairy',         keys:['dairy','milk','cheese','yogurt','yoghurt','butter','cream','paneer','ghee','curd','lassi','whey'] },
  { cat:'Beverages',     keys:['beverage','drink','water','soda','juice','tea','coffee','cola','smoothie','shake','energy drink','soft drink','squash','nectar','lemonade','coconut water'] },
  { cat:'Fruits',        keys:['fruit','apple','mango','banana','orange','grape','berry','berries','pineapple','papaya','guava','pomegranate','lychee','melon'] },
  { cat:'Vegetables',    keys:['vegetable','veggie','spinach','tomato','potato','onion','carrot','pea','bean','lentil','dal','rajma','chickpea','chana','mushroom','broccoli','cauliflower'] },
  { cat:'Meat & Seafood',keys:['meat','chicken','mutton','lamb','beef','pork','fish','seafood','prawn','shrimp','tuna','salmon','egg','poultry'] },
  { cat:'Bakery',        keys:['bread','biscuit','bakery','cookie','cake','pastry','rusk','cracker','wafer','muffin','bun','roll','chapati','roti','naan','pav'] },
  { cat:'Snacks',        keys:['snack','chip','namkeen','bhujia','mixture','popcorn','chocolate','candy','sweet','mithai','dessert','ice cream','icecream','halwa','ladoo','confection','nuts','peanut','cashew','almond','raisin'] },
  { cat:'Frozen Foods',  keys:['frozen','freeze'] },
  { cat:'Canned Goods',  keys:['canned','tinned','preserved','pickled','pickle','achar','jam','jelly','marmalade','conserve'] },
  { cat:'Condiments',    keys:['sauce','condiment','ketchup','mayonnaise','mustard','oil','vinegar','spice','masala','chutney','paste','dressing','seasoning','relish','curry'] },
  { cat:'Personal Care', keys:['soap','shampoo','lotion','toothpaste','deodorant','skincare','haircare','personal care','hygiene','detergent','cleanser'] },
];

const mapCategory = (tags = []) => {
  if (!tags?.length) return 'Other';
  const all = tags.map(t => t.split(':').pop().replace(/[-_]/g,' ').toLowerCase()).join(' ');
  for (const { cat, keys } of CATEGORY_RULES)
    if (keys.some(k => all.includes(k))) return cat;
  return 'Other';
};

const EMOJI_MAP = {
  dairy:'🥛',fruits:'🍎',vegetables:'🥦','meat & seafood':'🥩',
  bakery:'🍞',snacks:'🍪',beverages:'🥤','canned goods':'🥫',
  'frozen foods':'🧊',condiments:'🧴','personal care':'🧼',other:'📦',
};
const catEmoji = (cat='') => EMOJI_MAP[(cat||'').toLowerCase()] || '📦';

const ALL_CATEGORIES = [
  'Dairy','Fruits','Vegetables','Meat & Seafood','Bakery','Snacks',
  'Beverages','Canned Goods','Frozen Foods','Condiments','Personal Care','Other',
];

// ─── Image preprocessing ─────────────────────────────────────────────────────
function makeVariant(srcCanvas, type) {
  // Use 4x scale — critical for dot-matrix and ink-stamp fonts
  // Higher resolution gives Tesseract much more detail to work with
  const SCALE = type === 'dotmatrix' || type === 'dotmatrix-inv' ? 4 : 3;
  const c = document.createElement('canvas');
  c.width  = srcCanvas.width  * SCALE;
  c.height = srcCanvas.height * SCALE;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, 0, 0, c.width, c.height);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d  = id.data;
  const W  = c.width, H = c.height;

  if (type === 'grey') {
    // High-contrast greyscale with contrast boost
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const f = (259*(80+255))/(255*(259-80));
      const v = Math.min(255, Math.max(0, f*(g-128)+128));
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
  } else if (type === 'thresh') {
    // Binary threshold — dark text on white
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = g > 128 ? 255 : 0;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
  } else if (type === 'inv') {
    // Inverted threshold — white text on black (embossed/foil labels)
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = g > 128 ? 0 : 255;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
  } else if (type === 'dotmatrix') {
    // Dot-matrix / perforated label fix:
    // 1. Convert to greyscale
    // 2. Apply dilation (max-pool 3x3) to fill gaps between dots
    // 3. Then threshold to get solid strokes
    const grey = new Uint8Array(W * H);
    for (let i = 0; i < d.length; i += 4) {
      grey[i/4] = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
    }
    // Dilation: each pixel becomes the MAX of its 3x3 neighbourhood
    // This merges nearby dots into solid letter strokes
    const dilated = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let maxVal = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = Math.min(H-1, Math.max(0, y+dy));
            const nx = Math.min(W-1, Math.max(0, x+dx));
            maxVal = Math.max(maxVal, grey[ny*W+nx]);
          }
        }
        dilated[y*W+x] = maxVal;
      }
    }
    // Threshold the dilated result: dots merged into filled glyphs
    for (let i = 0; i < W*H; i++) {
      const v = dilated[i] > 100 ? 255 : 0;
      d[i*4]=d[i*4+1]=d[i*4+2]=v; d[i*4+3]=255;
    }
  } else if (type === 'dotmatrix-inv') {
    // Same as dotmatrix but inverted (for dark backgrounds with light dots)
    const grey = new Uint8Array(W * H);
    for (let i = 0; i < d.length; i += 4) {
      grey[i/4] = 255 - Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
    }
    const dilated = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let maxVal = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = Math.min(H-1, Math.max(0, y+dy));
            const nx = Math.min(W-1, Math.max(0, x+dx));
            maxVal = Math.max(maxVal, grey[ny*W+nx]);
          }
        }
        dilated[y*W+x] = maxVal;
      }
    }
    for (let i = 0; i < W*H; i++) {
      const v = dilated[i] > 100 ? 255 : 0;
      d[i*4]=d[i*4+1]=d[i*4+2]=v; d[i*4+3]=255;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png', 1.0); // PNG lossless — better for OCR than JPEG
}

// ─── Google Calendar helper ──────────────────────────────────────────────────
function buildCalendarUrl(productName, expiryISO) {
  // Reminder fires 1 day BEFORE expiry
  const expiryDate = new Date(expiryISO);
  const reminderDate = new Date(expiryDate);
  reminderDate.setDate(reminderDate.getDate() - 1);

  const fmt = (d) => d.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

  // All-day event on the reminder date
  const startStr = reminderDate.toISOString().slice(0,10).replace(/-/g,'');
  const endStr   = expiryDate.toISOString().slice(0,10).replace(/-/g,'');

  const params = new URLSearchParams({
    action:  'TEMPLATE',
    text:    `⏰ ${productName} expires tomorrow!`,
    dates:   `${startStr}/${endStr}`,
    details: `FreshTrack reminder: ${productName} expires on ${expiryDate.toLocaleDateString()}. Use it today!`,
    sf:      'true',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ─── Step indicator ──────────────────────────────────────────────────────────
const STEPS = [
  { n:1, label:'Scan Barcode',   icon:'fa-barcode'      },
  { n:2, label:'Read Expiry',    icon:'fa-calendar-alt' },
  { n:3, label:'Confirm & Save', icon:'fa-check'        },
];
const StepIndicator = memo(({ step }) => (
  <div className="sc-steps">
    {STEPS.map(({ n, label, icon }, i) => (
      <React.Fragment key={n}>
        <div className={`sc-step ${step===n?'active':''} ${step>n?'done':''}`}>
          <div className="sc-step-circle">
            {step>n ? <i className="fas fa-check"/> : <i className={`fas ${icon}`}/>}
          </div>
          <span>{label}</span>
        </div>
        {i < 2 && <div className={`sc-step-line ${step>n?'done':''}`}/>}
      </React.Fragment>
    ))}
  </div>
));

// ─── Scanner component ───────────────────────────────────────────────────────
const Scanner = ({ onProductScanned }) => {

  // UI state
  const [step,         setStep]         = useState(0);
  const [scanning,     setScanning]     = useState(false);
  const [progress,     setProgress]     = useState('');
  const [progressType, setProgressType] = useState('info');
  const [error,        setError]        = useState('');
  const [ocrRunning,   setOcrRunning]   = useState(false);
  const [saving,       setSaving]       = useState(false);

  // Crop state
  const [showCrop,  setShowCrop]  = useState(false);
  const [cropBox,   setCropBox]   = useState({ x:0.05, y:0.2, w:0.9, h:0.6 });
  const cropBoxRef  = useRef({ x:0.05, y:0.2, w:0.9, h:0.6 });
  const cropImgRef  = useRef(null);
  const dragState   = useRef(null);
  // Store native video aspect ratio so crop overlay matches image exactly
  const nativeAspectRef = useRef(null);

  // Product state
  const [productData,  setProductData]  = useState(null);
  const [capturedImg,  setCapturedImg]  = useState(null);
  const [ocrRawText,   setOcrRawText]   = useState('');
  const [expiryInput,  setExpiryInput]  = useState('');
  const [expiryISO,    setExpiryISO]    = useState('');
  const [calendarAdded, setCalendarAdded] = useState(false);

  // Refs
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const codeReader  = useRef(new BrowserMultiFormatReader());
  const pendingMode = useRef(null);

  // Attach stream after <video> mounts
  useEffect(() => {
    if (!scanning) return;
    const video  = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(e => console.warn('video.play():', e));
    }
    if (pendingMode.current === 'barcode') {
      pendingMode.current = null;
      setTimeout(() => {
        codeReader.current.decodeFromVideoDevice(null, video, async (result, err) => {
          if (result) {
            codeReader.current.reset();
            showMsg('Barcode detected — looking up product…');
            await fetchProduct(result.getText());
          }
          if (err && !(err instanceof NotFoundException)) console.warn('Barcode:', err.message);
        });
      }, 300);
    }
  }, [scanning]);

  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const showMsg = (msg, type='info') => { setProgress(msg); setProgressType(type); };

  const handleExpiryType = val => {
    setExpiryInput(val);
    setExpiryISO(parseTypedDate(val) || '');
  };

  const setExpiryFromOCR = (result) => {
    if (!result) { setExpiryInput(''); setExpiryISO(''); return; }
    setExpiryInput(result.display);
    setExpiryISO(result.iso);
  };

  // ── Camera ──────────────────────────────────────────────────────────────────
  const startCamera = async (mode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } },
      });
      streamRef.current  = stream;
      pendingMode.current = mode;
      setScanning(true);
      return true;
    } catch (e) {
      setError('Camera access denied. Please allow camera permission and try again.');
      return false;
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    try { codeReader.current.reset(); } catch {}
    pendingMode.current = null;
    setScanning(false);
  };

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = () => {
    stopCamera();
    setStep(0); setProgress(''); setError('');
    setProductData(null); setCapturedImg(null); setOcrRawText('');
    setExpiryInput(''); setExpiryISO('');
    setOcrRunning(false); setSaving(false);
    setShowCrop(false); setCalendarAdded(false);
    const def = { x:0.05, y:0.2, w:0.9, h:0.6 };
    cropBoxRef.current = def; setCropBox(def);
    nativeAspectRef.current = null;
  };

  // ── Step 1: Barcode ──────────────────────────────────────────────────────────
  const startBarcode = async () => {
    reset();
    setStep(1);
    showMsg('Opening camera…');
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
          barcode, name: p.product_name||p.product_name_en||p.abbreviated_product_name||'',
          brand: p.brands||'', category: mapCategory(p.categories_tags),
          image: p.image_front_url||p.image_url||null, quantity: p.quantity||'',
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

  // ── Step 2: OCR camera ────────────────────────────────────────────────────
  const startOCRCamera = async () => {
    setError('');
    showMsg('Opening camera…');
    if (!(await startCamera('ocr'))) return;
    showMsg('Point camera at the expiry date label, then tap Capture.');
  };

  // ── Capture frame ─────────────────────────────────────────────────────────
  //  KEY FIX: capture at NATIVE resolution (no 2× — the runOCROnCrop step scales
  //  up), store aspect ratio so the crop overlay maps 1:1 to the displayed image.
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v  = videoRef.current;
    const c  = canvasRef.current;
    const vw = v.videoWidth  || 1280;
    const vh = v.videoHeight || 720;
    c.width  = vw;
    c.height = vh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(v, 0, 0, vw, vh);
    const dataUrl = c.toDataURL('image/jpeg', 0.94);
    setCapturedImg(dataUrl);
    // Store native aspect so CSS can make the container the same ratio
    nativeAspectRef.current = vw / vh;
    stopCamera();
    const def = { x:0.05, y:0.2, w:0.9, h:0.6 };
    cropBoxRef.current = def; setCropBox(def);
    setShowCrop(true);
    showMsg('Drag the handles tightly around the expiry date, then tap Read Date.');
  };

  // ── Crop drag ─────────────────────────────────────────────────────────────
  const onCropPointerDown = useCallback((e, handle) => {
    e.preventDefault();
    const cx0 = e.touches ? e.touches[0].clientX : e.clientX;
    const cy0 = e.touches ? e.touches[0].clientY : e.clientY;
    // Always read the LATEST box from the ref to avoid stale closure
    dragState.current = { handle, startX: cx0, startY: cy0, startBox: { ...cropBoxRef.current } };

    const onMove = (ev) => {
      if (!dragState.current) return;
      const img = cropImgRef.current;
      if (!img) return;
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      // Use the rendered image's bounding rect — object-fit:fill means rect = image
      const rect = img.getBoundingClientRect();
      const dx   = (cx - dragState.current.startX) / rect.width;
      const dy   = (cy - dragState.current.startY) / rect.height;
      const b    = dragState.current.startBox;
      let { x, y, w, h } = b;
      const MIN = 0.05;
      switch (dragState.current.handle) {
        case 'tl': x=Math.min(b.x+dx,b.x+b.w-MIN); y=Math.min(b.y+dy,b.y+b.h-MIN); w=b.w-(x-b.x); h=b.h-(y-b.y); break;
        case 'tr': w=Math.max(b.w+dx,MIN); y=Math.min(b.y+dy,b.y+b.h-MIN); h=b.h-(y-b.y); break;
        case 'bl': x=Math.min(b.x+dx,b.x+b.w-MIN); w=b.w-(x-b.x); h=Math.max(b.h+dy,MIN); break;
        case 'br': w=Math.max(b.w+dx,MIN); h=Math.max(b.h+dy,MIN); break;
        case 't':  y=Math.min(b.y+dy,b.y+b.h-MIN); h=b.h-(y-b.y); break;
        case 'b':  h=Math.max(b.h+dy,MIN); break;
        case 'l':  x=Math.min(b.x+dx,b.x+b.w-MIN); w=b.w-(x-b.x); break;
        case 'r':  w=Math.max(b.w+dx,MIN); break;
        case 'move': x=b.x+dx; y=b.y+dy; break;
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
      window.removeEventListener('mousemove',  onMove);
      window.removeEventListener('mouseup',    onUp);
      window.removeEventListener('touchmove',  onMove);
      window.removeEventListener('touchend',   onUp);
    };
    window.addEventListener('mousemove',  onMove, { passive: false });
    window.addEventListener('mouseup',    onUp);
    window.addEventListener('touchmove',  onMove, { passive: false });
    window.addEventListener('touchend',   onUp);
  }, []);

  // ── OCR on cropped region ────────────────────────────────────────────────
  const runOCROnCrop = async () => {
    if (!capturedImg) return;

    // Snapshot box BEFORE any async/state changes
    const box = { ...cropBoxRef.current };
    setOcrRunning(true);
    setShowCrop(false);
    showMsg('Cropping…');

    try {
      // Load full-res image
      const fullImg = await new Promise((res, rej) => {
        const i = new Image();
        i.onload  = () => res(i);
        i.onerror = rej;
        i.src = capturedImg;
      });

      const natW = fullImg.naturalWidth  || fullImg.width;
      const natH = fullImg.naturalHeight || fullImg.height;

      const cropX = Math.round(natW * box.x);
      const cropY = Math.round(natH * box.y);
      const cropW = Math.max(20, Math.round(natW * box.w));
      const cropH = Math.max(20, Math.round(natH * box.h));

      // Draw crop to an isolated canvas — never reuse canvasRef during OCR
      // Always upscale to at least 200px tall; makeVariant will then scale 3-4x more
      const MIN_H  = 200;
      const upscale = cropH < MIN_H ? Math.ceil(MIN_H / cropH) : 1;
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width  = cropW * upscale;
      cropCanvas.height = cropH * upscale;
      const ctx = cropCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(fullImg, cropX, cropY, cropW, cropH, 0, 0, cropCanvas.width, cropCanvas.height);

      // Save cropped image for step 3 display
      const croppedUrl = cropCanvas.toDataURL('image/jpeg', 0.94);
      setCapturedImg(croppedUrl);

      // Try multiple image variants × PSM modes for maximum coverage:
      // - Standard variants: grey, thresh, inv
      // - Dot-matrix variants: dotmatrix, dotmatrix-inv (dilation fills dot gaps)
      // - PSM 6: block text  PSM 7: single line  PSM 13: raw line (no OSD)
      // Each combo runs until a date is found; order goes most→least likely.
      const TRIES = [
        // Single-line PSMs first (expiry date labels are almost always one line)
        { type:'grey',          psm:'7'  },
        { type:'thresh',        psm:'7'  },
        { type:'inv',           psm:'7'  },
        // Dot-matrix variants (dot-matrix / perforated fonts like the screenshot)
        { type:'dotmatrix',     psm:'7'  },
        { type:'dotmatrix-inv', psm:'7'  },
        { type:'dotmatrix',     psm:'13' },
        { type:'dotmatrix-inv', psm:'13' },
        // Block mode fallbacks
        { type:'grey',          psm:'6'  },
        { type:'thresh',        psm:'6'  },
        { type:'inv',           psm:'6'  },
        // Raw line — no layout analysis, best for single-row stamps
        { type:'grey',          psm:'13' },
        { type:'thresh',        psm:'13' },
      ];

      let ocrResult = null, bestText = '', triedCount = 0;
      for (const { type, psm } of TRIES) {
        // Stop after finding a result OR after 6 tries to keep it fast
        if (ocrResult) break;
        if (triedCount >= 6 && !ocrResult) {
          // Only continue past 6 if we have no result at all
          if (triedCount >= TRIES.length) break;
        }
        triedCount++;
        const label = triedCount === 1 ? 'Enhancing…'
                    : type.startsWith('dotmatrix') ? 'Trying dot-matrix mode…'
                    : 'Retrying…';
        showMsg(label);
        try {
          const variant = makeVariant(cropCanvas, type);
          const ocr = await Tesseract.recognize(variant, 'eng', {
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/-.: ',
            preserve_interword_spaces: '1',
            tessedit_pageseg_mode: psm,
          });
          const { text, words } = ocr.data;
          if (text.trim().length > bestText.length) bestText = text.trim();
          if (words?.length) { const r = extractExpiryFromWords(words); if (r) { ocrResult=r; break; } }
          const r = extractExpiryDate(text);
          if (r) { ocrResult=r; break; }
        } catch (e) { console.warn('OCR', type, psm, e.message); }
      }

      setOcrRawText(bestText);
      if (ocrResult) {
        setExpiryFromOCR(ocrResult);
        showMsg(`✅ Expiry date: ${ocrResult.display}`, 'success');
      } else {
        setExpiryInput(''); setExpiryISO('');
        showMsg('⚠️ Could not read date — please type it below.', 'warn');
      }
    } catch (err) {
      console.error('OCR error:', err);
      showMsg('⚠️ Image processing failed — please type the date.', 'warn');
    }

    setOcrRunning(false);
    setStep(3);
  };

  const skipToConfirm = () => { stopCamera(); setStep(3); setProgress(''); };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!productData || !expiryISO) return;
    setSaving(true);
    try {
      await onProductScanned({
        barcode:    productData.barcode,
        name:       productData.name   || `Product ${productData.barcode}`,
        brand:      productData.brand  || 'Unknown',
        category:   productData.category,
        image:      productData.image  || catEmoji(productData.category),
        expiryDate: expiryISO,
        quantity:   productData.quantity || '',
      });
      // Stay on step 3, show calendar option
      setSaving(false);
      showMsg('✅ Product saved!', 'success');
      setStep(4);  // confirmation + calendar step
    } catch {
      setError('Could not save product — please try again.');
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="sc-wrap">

      {/* ── STEP 0: Start ────────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="sc-start card">
          <div className="sc-start-icon"><i className="fas fa-barcode"/></div>
          <h2>Scan Product</h2>
          <p>Scan a barcode then capture the expiry date — we read it automatically.</p>
          <div className="sc-hiw">
            {[
              {n:'1',icon:'fa-barcode',    label:'Scan barcode'},
              {n:'2',icon:'fa-crop-alt',   label:'Crop & OCR date'},
              {n:'3',icon:'fa-check-circle',label:'Confirm & save'},
            ].map(s => (
              <div key={s.n} className="sc-hiw-step">
                <div className="sc-hiw-num">{s.n}</div>
                <i className={`fas ${s.icon}`}/>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary sc-btn-lg" onClick={startBarcode}>
            <i className="fas fa-camera"/> Start Scanning
          </button>
        </div>
      )}

      {/* ── STEPS 1–4 ────────────────────────────────────────────────────── */}
      {step > 0 && step < 5 && (
        <>
          <StepIndicator step={Math.min(step, 3)}/>

          {progress && (
            <div className={`sc-progress sc-progress--${progressType}`}>
              {progressType==='success' && <i className="fas fa-check-circle"/>}
              {progressType==='warn'    && <i className="fas fa-exclamation-triangle"/>}
              {progressType==='error'   && <i className="fas fa-times-circle"/>}
              {progressType==='info'    && <i className="fas fa-spinner fa-spin"/>}
              <span>{progress}</span>
            </div>
          )}
          {error && (
            <div className="sc-error">
              <i className="fas fa-times-circle"/> {error}
            </div>
          )}

          {/* ── STEP 1: Barcode ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="sc-viewport-wrap">
              <div className="sc-viewport">
                <video ref={videoRef} className="sc-video" playsInline muted autoPlay/>
                <canvas ref={canvasRef} style={{display:'none'}}/>
                <div className="sc-live-badge"><span className="sc-live-dot"/> LIVE</div>
                <div className="sc-barcode-overlay">
                  <div className="sc-barcode-target">
                    <span className="sc-target-label">Barcode</span>
                    <span className="sc-corner tl"/><span className="sc-corner tr"/>
                    <span className="sc-corner bl"/><span className="sc-corner br"/>
                    <span className="sc-scanline"/>
                  </div>
                </div>
                <div className="sc-viewport-hint">Centre the barcode — scans automatically</div>
              </div>
              <button className="btn btn-ghost sc-mt" onClick={reset}>
                <i className="fas fa-times"/> Cancel
              </button>
            </div>
          )}

          {/* ── STEP 2: OCR ─────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="sc-ocr-step">
              {productData && (
                <div className="sc-product-card card">
                  {productData.image
                    ? <img src={productData.image} alt="" className="sc-product-img"/>
                    : <div className="sc-product-emoji">{catEmoji(productData.category)}</div>
                  }
                  <div className="sc-product-details">
                    {productData.name
                      ? <><h4>{productData.name}</h4><p>{[productData.brand,productData.category].filter(Boolean).join(' · ')}</p></>
                      : <><h4 className="sc-not-found">Not in database</h4><p>Enter name manually in next step</p></>
                    }
                    <code>{productData.barcode}</code>
                  </div>
                </div>
              )}

              {/* A: Live camera */}
              {scanning && !showCrop && !ocrRunning && (
                <>
                  <div className="sc-ocr-tip">
                    <i className="fas fa-lightbulb"/>
                    <div><strong>Point at the expiry date label</strong><p>Hold steady, then tap Capture.</p></div>
                  </div>
                  <div className="sc-viewport">
                    <video ref={videoRef} className="sc-video" playsInline muted autoPlay/>
                    <canvas ref={canvasRef} style={{display:'none'}}/>
                    <div className="sc-live-badge"><span className="sc-live-dot"/> LIVE</div>
                    <div className="sc-viewport-hint">Aim at expiry date area</div>
                  </div>
                  <div className="sc-ocr-actions">
                    <button className="btn sc-btn-capture" onClick={captureFrame}>
                      <i className="fas fa-camera"/> Capture
                    </button>
                    <button className="btn btn-ghost" onClick={skipToConfirm}>
                      <i className="fas fa-forward"/> Skip — Enter Manually
                    </button>
                  </div>
                </>
              )}

              {/* B: Crop UI — THE FIX: image uses object-fit:fill, height:auto, no letterbox */}
              {showCrop && !ocrRunning && (
                <>
                  <div className="sc-ocr-tip sc-ocr-tip--blue">
                    <i className="fas fa-crop-alt"/>
                    <div><strong>Drag handles to frame the expiry date</strong><p>Then tap Read Date.</p></div>
                  </div>

                  <div
                    className="sc-crop-wrap"
                    style={nativeAspectRef.current ? { aspectRatio: nativeAspectRef.current } : {}}
                  >
                    {/* image fills container with NO bars — object-fit:fill */}
                    <img
                      ref={cropImgRef}
                      src={capturedImg}
                      alt="Captured"
                      className="sc-crop-img"
                      draggable={false}
                    />

                    {/* SVG overlay — viewBox 0 0 1 1 matches fraction coordinates exactly */}
                    <svg className="sc-crop-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
                      <defs>
                        <mask id="cropHole">
                          <rect width="1" height="1" fill="white"/>
                          <rect x={cropBox.x} y={cropBox.y} width={cropBox.w} height={cropBox.h} fill="black"/>
                        </mask>
                      </defs>
                      {/* Dim outside crop */}
                      <rect width="1" height="1" fill="rgba(0,0,0,0.58)" mask="url(#cropHole)"/>
                      {/* Crop border */}
                      <rect x={cropBox.x} y={cropBox.y} width={cropBox.w} height={cropBox.h}
                        fill="none" stroke="#4ade80" strokeWidth="0.004"/>
                      {/* Rule-of-thirds */}
                      {[1/3, 2/3].map(f => (
                        <React.Fragment key={f}>
                          <line x1={cropBox.x+cropBox.w*f} y1={cropBox.y}
                                x2={cropBox.x+cropBox.w*f} y2={cropBox.y+cropBox.h}
                                stroke="rgba(255,255,255,0.22)" strokeWidth="0.002"/>
                          <line x1={cropBox.x} y1={cropBox.y+cropBox.h*f}
                                x2={cropBox.x+cropBox.w} y2={cropBox.y+cropBox.h*f}
                                stroke="rgba(255,255,255,0.22)" strokeWidth="0.002"/>
                        </React.Fragment>
                      ))}
                    </svg>

                    {/* Move entire box */}
                    <div className="sc-crop-move"
                      style={{left:`${cropBox.x*100}%`,top:`${cropBox.y*100}%`,
                              width:`${cropBox.w*100}%`,height:`${cropBox.h*100}%`}}
                      onMouseDown={e=>onCropPointerDown(e,'move')}
                      onTouchStart={e=>onCropPointerDown(e,'move')}/>

                    {/* 4 corner handles */}
                    {[['tl',0,0],['tr',1,0],['bl',0,1],['br',1,1]].map(([h,fx,fy])=>(
                      <div key={h}
                        className={`sc-crop-handle sc-crop-h-${h}`}
                        style={{left:`${(cropBox.x+cropBox.w*fx)*100}%`,
                                top: `${(cropBox.y+cropBox.h*fy)*100}%`}}
                        onMouseDown={e=>onCropPointerDown(e,h)}
                        onTouchStart={e=>onCropPointerDown(e,h)}/>
                    ))}

                    {/* 4 edge handles */}
                    {[['t',0.5,0],['b',0.5,1],['l',0,0.5],['r',1,0.5]].map(([h,fx,fy])=>(
                      <div key={h}
                        className={`sc-crop-handle sc-crop-h-edge sc-crop-h-${h}`}
                        style={{left:`${(cropBox.x+cropBox.w*fx)*100}%`,
                                top: `${(cropBox.y+cropBox.h*fy)*100}%`}}
                        onMouseDown={e=>onCropPointerDown(e,h)}
                        onTouchStart={e=>onCropPointerDown(e,h)}/>
                    ))}
                  </div>

                  <div className="sc-ocr-actions">
                    <button className="btn btn-primary" onClick={runOCROnCrop}>
                      <i className="fas fa-search"/> Read Date
                    </button>
                    <button className="btn btn-ghost" onClick={()=>{ setShowCrop(false); startOCRCamera(); }}>
                      <i className="fas fa-redo"/> Retake
                    </button>
                    <button className="btn btn-ghost" onClick={skipToConfirm}>
                      <i className="fas fa-forward"/> Skip — Enter Manually
                    </button>
                  </div>
                </>
              )}

              {/* C: OCR running */}
              {ocrRunning && (
                <div className="sc-ocr-placeholder">
                  <div className="spinner"/>
                  <p>Reading expiry date…</p>
                </div>
              )}

              {/* D: Idle */}
              {!scanning && !showCrop && !ocrRunning && (
                <>
                  <div className="sc-ocr-tip">
                    <i className="fas fa-lightbulb"/>
                    <div><strong>Now scan the expiry date</strong><p>Open camera, capture, then crop around the date.</p></div>
                  </div>
                  <div className="sc-ocr-placeholder">
                    <i className="fas fa-calendar-alt"/>
                    <p>Tap "Open Camera" to start</p>
                  </div>
                  <div className="sc-ocr-actions">
                    <button className="btn btn-primary" onClick={startOCRCamera}>
                      <i className="fas fa-camera"/> Open Camera
                    </button>
                    <button className="btn btn-ghost" onClick={skipToConfirm}>
                      <i className="fas fa-forward"/> Skip — Enter Manually
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Confirm & save ───────────────────────────────────── */}
          {step === 3 && productData && (
            <div className="sc-confirm-step card">
              <h3><i className="fas fa-clipboard-check"/> Review &amp; Confirm</h3>

              {capturedImg && (
                <div className="sc-captured">
                  <img src={capturedImg} alt="Captured label" className="sc-captured-img"/>
                  {ocrRawText && (
                    <div className="sc-ocr-raw">
                      <i className="fas fa-eye"/>
                      <span>OCR read: <em>{ocrRawText.replace(/\n/g,' ').substring(0,140)}</em></span>
                    </div>
                  )}
                </div>
              )}

              <div className="sc-form">
                <div className="sc-field sc-field--full">
                  <label><i className="fas fa-tag"/> Product Name *</label>
                  <input className="input-field"
                    type="text" value={productData.name}
                    onChange={e=>setProductData({...productData,name:e.target.value})}
                    placeholder="Enter product name"/>
                  {!productData.name && <p className="field-error"><i className="fas fa-exclamation-circle"/>Name is required</p>}
                </div>

                <div className="sc-field">
                  <label><i className="fas fa-building"/> Brand</label>
                  <input className="input-field"
                    type="text" value={productData.brand}
                    onChange={e=>setProductData({...productData,brand:e.target.value})}
                    placeholder="e.g. Amul, Nestle"/>
                </div>

                <div className="sc-field">
                  <label><i className="fas fa-folder"/> Category</label>
                  <select className="input-field"
                    value={productData.category}
                    onChange={e=>setProductData({...productData,category:e.target.value})}>
                    {ALL_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="sc-field sc-field--full">
                  <label>
                    <i className="fas fa-calendar-alt"/> Expiry Date *
                    {expiryISO && <span className="sc-ocr-badge"><i className="fas fa-magic"/> OCR auto-filled</span>}
                  </label>
                  <input className={`input-field sc-expiry-input ${expiryISO?'is-valid':expiryInput?'is-invalid':''}`}
                    type="text" value={expiryInput}
                    onChange={e=>handleExpiryType(e.target.value)}
                    placeholder="OCR auto-fills · or type any format e.g. 29/01/2026"
                    autoComplete="off" spellCheck={false}/>
                  {expiryISO && (
                    <div className="sc-expiry-confirm">
                      <i className="fas fa-check-circle"/>
                      <strong>{formatISO(expiryISO)}</strong>
                      <code>{expiryISO}</code>
                    </div>
                  )}
                  {expiryInput && !expiryISO && (
                    <p className="field-error"><i className="fas fa-exclamation-circle"/>
                      Try: 29/01/2026 · JAN 2026 · 29.01.26 · 2026-01-29</p>
                  )}
                </div>

                <div className="sc-field">
                  <label><i className="fas fa-weight"/> Quantity</label>
                  <input className="input-field"
                    type="text" value={productData.quantity}
                    onChange={e=>setProductData({...productData,quantity:e.target.value})}
                    placeholder="e.g. 500ml, 1kg"/>
                </div>
              </div>

              <div className="sc-confirm-actions">
                <button className="btn btn-ghost" onClick={reset}>
                  <i className="fas fa-times"/> Cancel
                </button>
                <button className="btn btn-primary"
                  onClick={handleSave}
                  disabled={!productData.name||!expiryISO||saving}>
                  {saving
                    ? <><i className="fas fa-spinner fa-spin"/> Saving…</>
                    : <><i className="fas fa-check"/> Add to Inventory</>}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Saved + Google Calendar offer ────────────────────── */}
          {step === 4 && productData && expiryISO && (
            <div className="sc-saved-step card">
              <div className="sc-saved-icon">
                <i className="fas fa-check-circle"/>
              </div>
              <h3>{productData.name} added!</h3>
              <p>Expiry: <strong>{formatISO(expiryISO)}</strong></p>
              <p className="sc-saved-sub">You'll get email alerts 7, 3 &amp; 1 day before expiry.</p>

              {/* Google Calendar CTA */}
              {!calendarAdded ? (
                <a
                  className="btn btn-primary sc-cal-btn"
                  href={buildCalendarUrl(productData.name, expiryISO)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setCalendarAdded(true)}
                >
                  <i className="fab fa-google"/> Add 1-Day Reminder to Google Calendar
                </a>
              ) : (
                <div className="sc-cal-done">
                  <i className="fas fa-calendar-check"/> Reminder added to Google Calendar!
                </div>
              )}

              <button className="btn btn-ghost sc-mt" onClick={reset}>
                <i className="fas fa-plus"/> Scan Another Product
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Scanner;
