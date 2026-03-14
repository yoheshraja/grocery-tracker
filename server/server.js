import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { scheduleJob } from 'node-schedule';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fresh-track-secret-key';

// ── Nodemailer transporter ──────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
transporter.verify((err) => {
  if (err) console.error('❌ Email transporter error:', err.message);
  else     console.log('✅ Email transporter ready');
});

// ── Twilio SMS (optional — only if credentials present) ───────────────────
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID !== 'your_twilio_sid') {
  try {
    const twilio = await import('twilio');
    twilioClient = twilio.default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio SMS ready');
  } catch { console.warn('⚠️  Twilio not installed — SMS disabled'); }
}

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "https://freshtrack-frontend.onrender.com"
  ],
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json());

// ── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => { console.log('✅ MongoDB connected:', mongoose.connection.name); startServer(); })
  .catch(err => {
    console.error('❌ MongoDB Atlas failed:', err.message);
    mongoose.connect('mongodb://127.0.0.1:27017/grocery-tracker')
      .then(() => { console.log('✅ Local MongoDB connected'); startServer(); })
      .catch(e2 => { console.error('❌ Local MongoDB failed:', e2.message); startServer(); });
  });

// ── Schemas ──────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  phone:    { type: String, default: '' },
  password: { type: String, required: true },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  barcode:  { type: String, required: true },
  name:     { type: String, required: true },
  category: { type: String, required: true },
  brand:    { type: String, default: 'Unknown' },
  image:    { type: String, default: '📦' },
  expiryDate:{ type: Date, required: true },
  scanDate: { type: Date, default: Date.now },
  notificationsSent: {
    sevenDays: { type: Boolean, default: false },
    threeDays: { type: Boolean, default: false },
    oneDay:    { type: Boolean, default: false },
    expired:   { type: Boolean, default: false },
  },
}, { timestamps: true });

const User    = mongoose.model('User',    userSchema);
const Product = mongoose.model('Product', productSchema);

// OTP store (use Redis in production)
const otpStore = new Map();

// ── Email helper ─────────────────────────────────────────────────────────────
async function sendExpiryEmail(to, productName, expiryDateStr, type) {
  const colours   = { '7 days':'#2563eb','3 days':'#d97706','1 day':'#dc2626','today':'#7c3aed' };
  const emojis    = { '7 days':'🟡','3 days':'🟠','1 day':'🔴','today':'🚨' };
  const urgencies = { '7 days':'in 7 days','3 days':'in 3 days','1 day':'tomorrow','today':'TODAY' };

  const col = colours[type] || '#2563eb';
  const em  = emojis[type]  || '⚠️';
  const urg = urgencies[type] || 'soon';

  const subject = `${em} FreshTrack: ${productName} expires ${urg}`;

  await transporter.sendMail({
    from: `"FreshTrack" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9;">
        <div style="background:white;padding:30px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-flex;align-items:center;gap:8px;">
              <span style="font-size:24px;">🍃</span>
              <span style="font-size:20px;font-weight:800;color:#0f172a;">FreshTrack</span>
            </div>
          </div>
          <div style="border-left:4px solid ${col};padding:16px 20px;background:${col}11;border-radius:0 8px 8px 0;margin-bottom:24px;">
            <h2 style="color:${col};margin:0 0 8px;">${em} ${productName} expires ${urg}</h2>
            <p style="margin:0;color:#475569;font-size:15px;">
              <strong>Expiry Date:</strong> ${expiryDateStr}
            </p>
          </div>
          <p style="color:#475569;font-size:15px;line-height:1.6;">
            ${type === 'today'
              ? '🚨 This product has expired. Please discard it to avoid any health risk.'
              : type === '1 day'
              ? '⚠️ This product expires <strong>tomorrow</strong>. Use it today!'
              : `This product expires <strong>${urg}</strong>. Consider using it soon to avoid waste.`
            }
          </p>
          <div style="background:#f0fdf4;padding:16px;border-radius:8px;margin:20px 0;">
            <p style="margin:0;color:#15803d;font-size:14px;">
              💡 <strong>Tip:</strong> Check your FreshTrack dashboard to view all expiry statuses and manage your inventory.
            </p>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px;">
            This is an automated alert from FreshTrack. To manage your notification preferences, log into your account.
          </p>
        </div>
      </div>
    `,
  });
  console.log(`📧 Email sent → ${to}: ${subject}`);
}

// ── SMS helper ──────────────────────────────────────────────────────────────
async function sendExpirySMS(phone, productName, expiryDateStr, type) {
  if (!twilioClient) return;
  const urgencies = { '7 days':'in 7 days','3 days':'in 3 days','1 day':'tomorrow','today':'TODAY' };
  const body = `FreshTrack Alert: ${productName} expires ${urgencies[type]||'soon'} (${expiryDateStr}). Open FreshTrack to manage your inventory.`;
  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE,
      to:   phone.startsWith('+') ? phone : `+91${phone}`,
    });
    console.log(`📱 SMS sent → ${phone}`);
  } catch (e) {
    console.error('SMS error:', e.message);
  }
}

// ── Notification checker ─────────────────────────────────────────────────────
async function checkAndSendNotifications() {
  console.log('🔔 Running daily expiry check…');
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const products = await Product.find({
      $or: [
        { 'notificationsSent.sevenDays': false },
        { 'notificationsSent.threeDays': false },
        { 'notificationsSent.oneDay':    false },
        { 'notificationsSent.expired':   false },
      ]
    }).populate('userId');

    console.log(`📦 Checking ${products.length} products`);
    let sent = 0;

    for (const product of products) {
      if (!product.userId) continue;

      const expiry   = new Date(product.expiryDate);
      expiry.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((expiry - today) / 86400000);

      let type = null, field = null;
      if (daysLeft === 7 && !product.notificationsSent.sevenDays) { type='7 days'; field='sevenDays'; }
      else if (daysLeft === 3 && !product.notificationsSent.threeDays) { type='3 days'; field='threeDays'; }
      else if (daysLeft === 1 && !product.notificationsSent.oneDay)    { type='1 day'; field='oneDay'; }
      else if (daysLeft === 0 && !product.notificationsSent.expired)   { type='today'; field='expired'; }

      if (!type) continue;

      const user         = product.userId;
      const expiryStr    = expiry.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

      // Send email
      if (user.email) {
        try { await sendExpiryEmail(user.email, product.name, expiryStr, type); }
        catch (e) { console.error('Email failed:', e.message); }
      }

      // Send SMS (if phone exists and Twilio configured)
      if (user.phone) {
        await sendExpirySMS(user.phone, product.name, expiryStr, type);
      }

      // Mark notification sent — prevents duplicates
      product.notificationsSent[field] = true;
      await product.save();
      sent++;
      console.log(`✅ Notified ${type} → "${product.name}" for ${user.email}`);
    }

    console.log(`📨 Total notifications sent: ${sent}`);
  } catch (err) {
    console.error('❌ Notification check error:', err);
  }
}

// Daily at 9:00 AM
scheduleJob('0 9 * * *', checkAndSendNotifications);

// ── Auth middleware ──────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/',       (_, res) => res.json({ status:'OK', service:'FreshTrack API v2.0' }));
app.get('/health', (_, res) => res.json({ status:'Healthy', db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected' }));

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name?.trim())     return res.status(400).json({ message: 'Name is required' });
    if (!email?.trim())    return res.status(400).json({ message: 'Email is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Invalid email format' });
    if (!password)         return res.status(400).json({ message: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing)  return res.status(400).json({ message: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await new User({ name: name.trim(), email: email.toLowerCase().trim(), phone: phone?.trim()||'', password: hashed }).save();

    const token = jwt.sign({ userId: user._id, email: user.email, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });

    // Welcome email (non-blocking)
    transporter.sendMail({
      from: `"FreshTrack" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: '🎉 Welcome to FreshTrack!',
      html: `<div style="font-family:Arial,sans-serif;padding:20px;max-width:500px;">
        <h2 style="color:#3b6cf6;">Welcome, ${user.name}! 🍃</h2>
        <p>Your FreshTrack account is ready. Start scanning products to track expiry dates and reduce food waste.</p>
        <p>You'll receive alerts <strong>7, 3, and 1 day</strong> before any product expires.</p>
      </div>`,
    }).catch(e => console.error('Welcome email error:', e.message));

    res.status(201).json({ message: 'Registration successful!', token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ message: 'Invalid email or password' });

    const token = jwt.sign({ userId: user._id, email: user.email, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ message: 'Login successful!', token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Forgot Password — Send OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success:false, message:'Email is required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user)  return res.status(404).json({ success:false, message:'No account found with this email' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email.toLowerCase().trim(), { otp, expiresAt: Date.now() + 5*60*1000 });

    await transporter.sendMail({
      from: `"FreshTrack" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Password Reset OTP — FreshTrack',
      html: `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;">
        <h2 style="color:#3b6cf6;">Password Reset OTP</h2>
        <p>Use the code below to reset your FreshTrack password. It is valid for <strong>5 minutes</strong>.</p>
        <div style="background:#f4f6fb;padding:24px;text-align:center;border-radius:12px;margin:20px 0;">
          <h1 style="letter-spacing:12px;color:#0f172a;margin:0;">${otp}</h1>
        </div>
        <p style="color:#94a3b8;font-size:13px;">If you didn't request this, please ignore this email.</p>
      </div>`,
    });

    res.json({ success:true, message:'OTP sent to your email' });
  } catch (err) {
    console.error('Forgot-password error:', err);
    res.status(500).json({ success:false, message:'Failed to send OTP' });
  }
});

// Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ success:false, message:'Email and OTP required' });
  const data = otpStore.get(email.toLowerCase().trim());
  if (!data || Date.now() > data.expiresAt) { otpStore.delete(email.toLowerCase().trim()); return res.status(400).json({ success:false, message:'OTP expired' }); }
  if (data.otp !== otp) return res.status(400).json({ success:false, message:'Invalid OTP' });
  data.verified = true;
  otpStore.set(email.toLowerCase().trim(), data);
  res.json({ success:true, message:'OTP verified' });
});

// Resend OTP
app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success:false, message:'Email required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user)  return res.status(404).json({ success:false, message:'Account not found' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email.toLowerCase().trim(), { otp, expiresAt: Date.now() + 5*60*1000 });
    await transporter.sendMail({
      from:`"FreshTrack" <${process.env.EMAIL_USER}>`,
      to:email,
      subject:'New OTP — FreshTrack',
      html:`<div style="font-family:Arial,sans-serif;padding:20px;max-width:500px;">
        <h2 style="color:#3b6cf6;">Your New OTP</h2>
        <div style="background:#f4f6fb;padding:24px;text-align:center;border-radius:12px;margin:16px 0;">
          <h1 style="letter-spacing:12px;color:#0f172a;margin:0;">${otp}</h1>
          <p style="color:#64748b;margin-top:8px;">Valid for 5 minutes</p>
        </div></div>`,
    });
    res.json({ success:true, message:'OTP resent' });
  } catch (err) {
    res.status(500).json({ success:false, message:'Failed to resend OTP' });
  }
});

// Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ success:false, message:'All fields required' });
    if (newPassword.length < 6) return res.status(400).json({ success:false, message:'Password must be at least 6 characters' });
    const data = otpStore.get(email.toLowerCase().trim());
    if (!data || !data.verified || data.otp !== otp || Date.now() > data.expiresAt)
      return res.status(400).json({ success:false, message:'Invalid or expired OTP' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    otpStore.delete(email.toLowerCase().trim());
    res.json({ success:true, message:'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// ── Product routes ───────────────────────────────────────────────────────────
app.get('/api/products', auth, async (req, res) => {
  try {
    const products = await Product.find({ userId: req.user.userId }).sort({ expiryDate: 1 });
    res.json(products);
  } catch (err) { res.status(500).json({ message:'Server error' }); }
});

app.post('/api/products', auth, async (req, res) => {
  try {
    const { name, barcode, category, brand, image, expiryDate, quantity } = req.body;
    if (!name?.trim())  return res.status(400).json({ message:'Product name is required' });
    if (!expiryDate)    return res.status(400).json({ message:'Expiry date is required' });

    const expDate = new Date(expiryDate);
    if (isNaN(expDate.getTime())) return res.status(400).json({ message:'Invalid expiry date' });

    const product = await new Product({
      userId: req.user.userId,
      barcode: barcode || `manual_${Date.now()}`,
      name: name.trim(), category: category || 'Other',
      brand: brand || 'Unknown', image: image || '📦',
      expiryDate: expDate, quantity: quantity || '',
    }).save();

    res.status(201).json({ message:'Product added successfully!', product });
  } catch (err) {
    console.error('Add product error:', err);
    res.status(500).json({ message:'Server error' });
  }
});

app.put('/api/products/:id', auth, async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      req.body,
      { new: true }
    );
    if (!product) return res.status(404).json({ message:'Product not found' });
    res.json({ message:'Product updated', product });
  } catch (err) { res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/products/:id', auth, async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!product) return res.status(404).json({ message:'Product not found' });
    res.json({ message:'Product deleted' });
  } catch (err) { res.status(500).json({ message:'Server error' }); }
});

// Manual trigger for testing (dev only)
app.post('/api/admin/trigger-notifications', auth, async (req, res) => {
  await checkAndSendNotifications();
  res.json({ message:'Notification check triggered' });
});

// ── Start server ─────────────────────────────────────────────────────────────
function startServer() {
  app.listen(PORT, () => {
    console.log(`\n✅ FreshTrack API running on port ${PORT}`);
    console.log(`📡 http://localhost:${PORT}`);
    console.log(`🔔 Daily notification job: 9:00 AM every day`);
  });
}
