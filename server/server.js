import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { scheduleJob } from 'node-schedule';

dotenv.config();

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fresh-track-secret-key';

// ── Email ────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ── Twilio SMS ───────────────────────────────────
// TWILIO_PHONE  = your Twilio trial/purchased number (e.g. +14155552671)
// user.phone    = recipient's personal mobile number
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ── Middleware ───────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed =
      /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin) ||
      origin === 'https://freshtrack-frontend.onrender.com';
    if (allowed) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept']
}));
app.use(express.json());

console.log('\n🚀 ============================================');
console.log('🚀  STARTING FRESH-TRACK SERVER v3.0');
console.log('🚀 ============================================');

// ── MongoDB ──────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => { console.log('✅ MongoDB Atlas connected:', mongoose.connection.name); startServer(); })
  .catch(err => {
    console.error('❌ Atlas failed:', err.message, '→ trying local…');
    mongoose.connect('mongodb://127.0.0.1:27017/grocery-tracker')
      .then(() => { console.log('✅ Local MongoDB connected'); startServer(); })
      .catch(() => { console.log('⚠️  No DB — DEMO MODE'); startServer(); });
  });

// ── Categories ───────────────────────────────────
export const PRODUCT_CATEGORIES = [
  'Dairy', 'Fruits', 'Vegetables', 'Meat & Seafood',
  'Bakery', 'Snacks', 'Beverages', 'Canned Goods',
  'Frozen Foods', 'Condiments', 'Personal Care', 'Other'
];

// ── Schemas ──────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  phone:    { type: String, default: '' },
  password: { type: String, required: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const productSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  barcode:   { type: String, required: true },
  name:      { type: String, required: true },
  category:  { type: String, enum: PRODUCT_CATEGORIES, default: 'Other' },
  brand:     { type: String, default: '' },
  image:     { type: String, default: '📦' },
  expiryDate:{ type: Date, required: true },
  scanDate:  { type: Date, default: Date.now },
  quantity:  { type: String, default: '' },
  notes:     { type: String, default: '' },
  notificationsSent: {
    sevenDays: { type: Boolean, default: false },
    threeDays: { type: Boolean, default: false },
    oneDay:    { type: Boolean, default: false },
    expired:   { type: Boolean, default: false }
  }
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);
const otpStore = new Map();

// ── Auth middleware ──────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user; next();
  });
};

// ── Notification helpers ─────────────────────────
function buildExpiryEmailHTML(product, type) {
  const colors = { '7 days':'#ffa000','3 days':'#f57c00','1 day':'#e53935','expired':'#b71c1c' };
  const color  = colors[type] || '#4a7c59';
  const expStr = new Date(product.expiryDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const msgs   = {
    '7 days': `<b>${product.name}</b> will expire in <b>7 days</b> on ${expStr}. Plan to use it soon.`,
    '3 days': `<b>${product.name}</b> expires in <b>3 days</b> on ${expStr}. Use it before it's too late!`,
    '1 day':  `<b>${product.name}</b> expires <b>tomorrow</b> (${expStr}). Use it today!`,
    expired:  `<b>${product.name}</b> expired on ${expStr}. Please discard it from your inventory.`
  };
  return `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#f4f4f4;padding:20px;">
  <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1);">
    <div style="background:${color};padding:26px 30px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:-.5px;">🍎 FreshTrack</h1>
      <p style="color:rgba(255,255,255,.85);margin:5px 0 0;font-size:13px;">Grocery Expiry Alert</p>
    </div>
    <div style="padding:28px 30px;">
      <h2 style="color:#333;font-size:18px;margin:0 0 14px;">
        ${{ '7 days':'🟡 Reminder — 7 Days', '3 days':'🟠 Alert — 3 Days', '1 day':'🔴 Expires Tomorrow!', expired:'🚨 Product Expired' }[type]}
      </h2>
      <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 18px;">${msgs[type]}</p>
      <div style="background:#f8f8f8;border-radius:10px;padding:18px;border-left:4px solid ${color};">
        <p style="margin:0;font-size:14px;color:#333;line-height:1.9;">
          📦 <b>Product:</b> ${product.name}<br>
          🏷️ <b>Category:</b> ${product.category}<br>
          ${product.brand ? `🏭 <b>Brand:</b> ${product.brand}<br>` : ''}
          📅 <b>Expiry Date:</b> ${expStr}
        </p>
      </div>
      <p style="color:#aaa;font-size:12px;margin:22px 0 0;padding-top:14px;border-top:1px solid #eee;">
        Automated alert from FreshTrack. Do not reply.
      </p>
    </div>
  </div>
</div>`;
}

// Send email — expiry alerts ONLY (never on product add)
async function sendExpiryEmail(user, product, type) {
  if (!user?.email) return;
  const subjects = {
    '7 days':`🟡 Reminder: ${product.name} expires in 7 days`,
    '3 days':`🟠 Alert: ${product.name} expires in 3 days`,
    '1 day': `🔴 URGENT: ${product.name} expires tomorrow!`,
    expired: `🚨 ${product.name} has expired!`
  };
  try {
    await transporter.sendMail({ from:`"FreshTrack" <${process.env.EMAIL_USER}>`, to:user.email, subject:subjects[type], html:buildExpiryEmailHTML(product, type) });
    console.log(`📧 Email → ${user.email} [${type}]: ${product.name}`);
  } catch (e) { console.error('Email error:', e.message); }
}

// Send SMS — expiry alerts ONLY
async function sendExpirySMS(user, product, type) {
  if (!twilioClient || !user?.phone) return;
  const expStr = new Date(product.expiryDate).toLocaleDateString('en-IN');
  const msgs = {
    '7 days':`FreshTrack: "${product.name}" expires in 7 days (${expStr}). Plan to use it.`,
    '3 days':`FreshTrack: ⚠️ "${product.name}" expires in 3 days (${expStr}). Use it soon!`,
    '1 day': `FreshTrack: 🔴 "${product.name}" expires TOMORROW (${expStr}). Use it today!`,
    expired: `FreshTrack: 🚨 "${product.name}" expired on ${expStr}. Please discard it.`
  };
  const phone = user.phone.startsWith('+') ? user.phone : `+91${user.phone}`;
  try {
    await twilioClient.messages.create({ body:msgs[type], from:process.env.TWILIO_PHONE, to:phone });
    console.log(`📱 SMS → ${phone} [${type}]: ${product.name}`);
  } catch (e) { console.error('SMS error:', e.message); }
}

// Daily check — runs at 9 AM
async function checkAndSendNotifications() {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const products = await Product.find().populate('userId').lean();
    console.log(`🔔 Checking ${products.length} products…`);
    let sent = 0;
    for (const p of products) {
      if (!p.userId) continue;
      const exp = new Date(p.expiryDate); exp.setHours(0,0,0,0);
      const days = Math.ceil((exp - today) / 86400000);
      for (const { d, key, type } of [
        { d:7, key:'sevenDays', type:'7 days' },
        { d:3, key:'threeDays', type:'3 days' },
        { d:1, key:'oneDay',    type:'1 day'  },
        { d:0, key:'expired',   type:'expired' }
      ]) {
        if (days === d && !p.notificationsSent[key]) {
          await Promise.all([ sendExpiryEmail(p.userId, p, type), sendExpirySMS(p.userId, p, type) ]);
          await Product.findByIdAndUpdate(p._id, { [`notificationsSent.${key}`]: true });
          sent++; break;
        }
      }
    }
    console.log(`✅ ${sent} notification(s) sent`);
  } catch (e) { console.error('Notification error:', e); }
}

scheduleJob('0 9 * * *', () => { console.log('🕘 Daily check:', new Date().toLocaleString()); checkAndSendNotifications(); });

// ── ROUTES ───────────────────────────────────────
app.get('/', (req,res) => res.json({ message:'🎯 FreshTrack API v3.0', status:'Online', db: mongoose.connection.readyState===1?'Connected':'Disconnected', sms:twilioClient?'Enabled':'Disabled' }));
app.get('/api/test',       (req,res) => res.json({ ok:true }));
app.get('/health',         (req,res) => res.json({ status:'Healthy' }));
app.get('/api/categories', (req,res) => res.json({ categories: PRODUCT_CATEGORIES }));

// Register
app.post('/api/register', async (req,res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ message:'Name, email and password are required' });
    if (password.length<6) return res.status(400).json({ message:'Password must be at least 6 characters' });
    if (await User.findOne({ email:email.toLowerCase().trim() })) return res.status(400).json({ message:'Email already registered' });
    const user = new User({ name:name.trim(), email:email.toLowerCase().trim(), phone:phone?.trim()||'', password:await bcrypt.hash(password,12) });
    await user.save();
    const token = jwt.sign({ userId:user._id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
    console.log('✅ Registered:', user.email);
    res.status(201).json({ message:'✅ Registration successful!', token, user:{ id:user._id, name:user.name, email:user.email, phone:user.phone } });
  } catch(e) { res.status(500).json({ message:'Server error', error:e.message }); }
});

// Login
app.post('/api/login', async (req,res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ message:'Email and password required' });
    const user = await User.findOne({ email:email.toLowerCase().trim() });
    if (!user||!(await bcrypt.compare(password,user.password))) return res.status(400).json({ message:'Invalid email or password' });
    const token = jwt.sign({ userId:user._id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
    res.json({ message:'✅ Login successful!', token, user:{ id:user._id, name:user.name, email:user.email, phone:user.phone } });
  } catch(e) { res.status(500).json({ message:'Server error', error:e.message }); }
});

// Forgot password → OTP
app.post('/api/auth/forgot-password', async (req,res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success:false, message:'Email required' });
    if (!await User.findOne({ email:email.toLowerCase().trim() })) return res.status(404).json({ success:false, message:'No account found with this email' });
    const otp = Math.floor(100000+Math.random()*900000).toString();
    otpStore.set(email.toLowerCase().trim(), { otp, expiresAt:Date.now()+5*60*1000 });
    await transporter.sendMail({ from:`"FreshTrack" <${process.env.EMAIL_USER}>`, to:email, subject:'Password Reset OTP — FreshTrack',
      html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;"><h2 style="color:#4CAF50;">Password Reset</h2><div style="background:#f5f5f5;padding:24px;border-radius:10px;text-align:center;margin:20px 0;"><h1 style="letter-spacing:12px;color:#333;margin:0;">${otp}</h1><p style="color:#666;margin-top:10px;">Valid for 5 minutes</p></div></div>` });
    res.json({ success:true, message:'OTP sent to your email' });
  } catch(e) { res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req,res) => {
  try {
    const { email, otp } = req.body;
    const data = otpStore.get(email?.toLowerCase().trim());
    if (!data) return res.status(400).json({ success:false, message:'OTP expired or invalid' });
    if (Date.now()>data.expiresAt) { otpStore.delete(email.toLowerCase().trim()); return res.status(400).json({ success:false, message:'OTP expired' }); }
    if (data.otp!==otp) return res.status(400).json({ success:false, message:'Invalid OTP' });
    data.verified=true; otpStore.set(email.toLowerCase().trim(), data);
    res.json({ success:true, message:'OTP verified' });
  } catch(e) { res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Resend OTP
app.post('/api/auth/resend-otp', async (req,res) => {
  try {
    const { email } = req.body;
    if (!await User.findOne({ email:email?.toLowerCase().trim() })) return res.status(404).json({ success:false, message:'No account found' });
    const otp = Math.floor(100000+Math.random()*900000).toString();
    otpStore.set(email.toLowerCase().trim(), { otp, expiresAt:Date.now()+5*60*1000 });
    await transporter.sendMail({ from:`"FreshTrack" <${process.env.EMAIL_USER}>`, to:email, subject:'New OTP — FreshTrack',
      html:`<div style="font-family:Arial;text-align:center;padding:20px;"><h2 style="color:#4CAF50;">New OTP</h2><h1 style="letter-spacing:12px;color:#333;">${otp}</h1><p style="color:#666;">Valid 5 minutes</p></div>` });
    res.json({ success:true, message:'New OTP sent' });
  } catch(e) { res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Reset password
app.post('/api/auth/reset-password', async (req,res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email||!otp||!newPassword) return res.status(400).json({ success:false, message:'All fields required' });
    if (newPassword.length<6) return res.status(400).json({ success:false, message:'Password must be 6+ characters' });
    const data = otpStore.get(email.toLowerCase().trim());
    if (!data||!data.verified||data.otp!==otp||Date.now()>data.expiresAt) return res.status(400).json({ success:false, message:'Invalid or expired OTP' });
    const user = await User.findOne({ email:email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    user.password = await bcrypt.hash(newPassword,12);
    await user.save(); otpStore.delete(email.toLowerCase().trim());
    res.json({ success:true, message:'Password reset successfully' });
  } catch(e) { res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Get products
app.get('/api/products', auth, async (req,res) => {
  try {
    const { category, search, status } = req.query;
    const q = { userId:req.user.userId };
    if (category&&category!=='all') q.category=category;
    if (search) q.$or=[{ name:{$regex:search,$options:'i'} },{ brand:{$regex:search,$options:'i'} }];
    let products = await Product.find(q).sort({ expiryDate:1 }).lean();
    if (status&&status!=='all') {
      const today=new Date(); today.setHours(0,0,0,0);
      products=products.filter(p => {
        const d=Math.ceil((new Date(p.expiryDate)-today)/86400000);
        if (status==='expired') return d<0;
        if (status==='expiring-soon') return d>=0&&d<=7;
        if (status==='safe') return d>7;
        return true;
      });
    }
    res.json(products);
  } catch(e) { res.status(500).json({ message:'Server error', error:e.message }); }
});

// Recent products
app.get('/api/products/recent', auth, async (req,res) => {
  try {
    const products = await Product.find({ userId:req.user.userId }).sort({ scanDate:-1 }).limit(20).lean();
    res.json(products);
  } catch(e) { res.status(500).json({ message:'Server error' }); }
});

// Add product — NO email on add
app.post('/api/products', auth, async (req,res) => {
  try {
    let category = req.body.category||'Other';
    const matched = PRODUCT_CATEGORIES.find(c=>c.toLowerCase()===category.toLowerCase());
    category = matched||'Other';
    const product = new Product({ ...req.body, category, userId:req.user.userId, expiryDate:new Date(req.body.expiryDate), scanDate:new Date() });
    await product.save();
    console.log(`✅ Added: ${product.name}`);
    res.status(201).json({ message:'✅ Product added!', product });
  } catch(e) { res.status(500).json({ message:'Server error', error:e.message }); }
});

// Edit product
app.put('/api/products/:id', auth, async (req,res) => {
  try {
    const { name, category, brand, expiryDate, notes, quantity } = req.body;
    let cat = category||'Other';
    const matched = PRODUCT_CATEGORIES.find(c=>c.toLowerCase()===cat.toLowerCase());
    cat = matched||'Other';
    const update = { category:cat, ...(name&&{name}), ...(brand!==undefined&&{brand}), ...(expiryDate&&{expiryDate:new Date(expiryDate)}), ...(notes!==undefined&&{notes}), ...(quantity!==undefined&&{quantity}), ...(expiryDate&&{'notificationsSent.sevenDays':false,'notificationsSent.threeDays':false,'notificationsSent.oneDay':false,'notificationsSent.expired':false}) };
    const product = await Product.findOneAndUpdate({ _id:req.params.id, userId:req.user.userId }, update, { new:true, runValidators:true });
    if (!product) return res.status(404).json({ message:'Product not found' });
    res.json({ message:'✅ Updated', product });
  } catch(e) { res.status(500).json({ message:'Server error', error:e.message }); }
});

// Delete product
app.delete('/api/products/:id', auth, async (req,res) => {
  try {
    const product = await Product.findOneAndDelete({ _id:req.params.id, userId:req.user.userId });
    if (!product) return res.status(404).json({ message:'Product not found' });
    res.json({ message:'✅ Deleted' });
  } catch(e) { res.status(500).json({ message:'Server error', error:e.message }); }
});

// ── Start ─────────────────────────────────────────
function startServer() {
  app.listen(PORT, () => {
    console.log(`\n✅ FreshTrack running → http://localhost:${PORT}`);
    console.log(`📱 SMS: ${twilioClient ? `Enabled (from ${process.env.TWILIO_PHONE})` : 'Disabled'}`);
    console.log('🔔 Expiry alerts: 7 days / 3 days / 1 day before expiry');
    console.log('🚫 No email on product add\n');
  });
}