import React, { memo } from 'react';
import { useTheme } from '..src/context/ThemeContext';
import './HomePage.css';

const FEATURES = [
  { icon: 'fa-barcode',       title: 'Barcode Scanner',      desc: 'Instantly identify any packaged product with your camera. Auto-fills product name from OpenFoodFacts.' },
  { icon: 'fa-eye',           title: 'OCR Date Reading',     desc: 'Point at the expiry label, crop precisely, and let AI extract the date automatically.' },
  { icon: 'fa-bell',          title: 'Smart Alerts',         desc: 'Get notified by email or SMS at 7, 3, and 1 day before expiry — before it\'s too late.' },
  { icon: 'fa-calendar-check',title: 'Google Calendar',      desc: 'Add expiry reminders directly to your Google Calendar with one tap.' },
  { icon: 'fa-chart-bar',     title: 'Live Dashboard',       desc: 'See all items colour-coded: green = safe, amber = expiring, red = expired.' },
  { icon: 'fa-mobile-alt',    title: 'Works Everywhere',     desc: 'Fully responsive on mobile, tablet, and desktop. Works in all modern browsers.' },
];

const STEPS = [
  { n: '01', icon: 'fa-camera',         title: 'Scan Barcode',       desc: 'Open the scanner and point at the product barcode. Details are fetched automatically.' },
  { n: '02', icon: 'fa-crop-alt',       title: 'Read Expiry Date',   desc: 'Capture the label, crop to the date line, and OCR fills it in for you.' },
  { n: '03', icon: 'fa-check-circle',   title: 'Confirm & Save',     desc: 'Review details, optionally add to Google Calendar, then save.' },
  { n: '04', icon: 'fa-bell',           title: 'Get Notified',       desc: 'Sit back — FreshTrack emails or texts you before anything expires.' },
];

const HomePage = memo(({ onLogin, onRegister }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="home-page">

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <nav className="home-nav">
        <div className="home-nav-inner">
          <div className="home-logo">
            <div className="home-logo-icon"><i className="fas fa-leaf" /></div>
            <span>FreshTrack</span>
          </div>
          <div className="home-nav-actions">
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              <i className={`fas fa-${theme === 'light' ? 'moon' : 'sun'}`} />
              {theme === 'light' ? 'Dark' : 'Light'}
            </button>
            <button className="btn btn-ghost" onClick={onLogin}>Sign In</button>
            <button className="btn btn-primary" onClick={onRegister}>Get Started</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-bg-blobs">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
        </div>
        <div className="hero-content">
          <div className="hero-badge">
            <i className="fas fa-leaf" /> Smart Grocery Management
          </div>
          <h1 className="hero-title">
            Never let food expire <span className="hero-accent">unnoticed</span> again
          </h1>
          <p className="hero-desc">
            FreshTrack automatically reads expiry dates from product labels using your camera,
            tracks your entire grocery inventory, and sends you timely alerts — so you reduce
            waste and save money effortlessly.
          </p>
          <div className="hero-ctas">
            <button className="btn btn-primary hero-btn-main" onClick={onRegister}>
              <i className="fas fa-rocket" /> Start Tracking Free
            </button>
            <button className="btn btn-ghost hero-btn-sec" onClick={onLogin}>
              <i className="fas fa-sign-in-alt" /> Sign In
            </button>
          </div>
          <div className="hero-stats">
            {[['Scan', 'Barcodes instantly'],['OCR', 'Reads expiry dates'],['3 alerts', '7, 3 & 1 day']].map(([val, label]) => (
              <div key={val} className="hero-stat">
                <strong>{val}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-phone-mock">
            <div className="phone-screen">
              <div className="mock-header">
                <div className="mock-dot" /><div className="mock-dot" /><div className="mock-dot" />
              </div>
              <div className="mock-scanner">
                <i className="fas fa-camera" />
                <span>Scanning…</span>
                <div className="mock-scanline" />
              </div>
              <div className="mock-items">
                {[
                  { name: 'Amul Milk 500ml',  days: 2, status: 'warn'   },
                  { name: 'Bread Loaf',       days: 5, status: 'warn'   },
                  { name: 'Cheddar Cheese',   days: 14, status: 'safe'  },
                ].map(item => (
                  <div key={item.name} className={`mock-item mock-item--${item.status}`}>
                    <span className="mock-item-name">{item.name}</span>
                    <span className={`badge badge-${item.status === 'safe' ? 'safe' : 'warn'}`}>
                      {item.days}d
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section className="features-section">
        <div className="section-inner">
          <div className="section-label">Features</div>
          <h2 className="section-title">Everything you need to track freshness</h2>
          <p className="section-sub">From scan to notification — fully automated, zero manual work.</p>
          <div className="features-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="feature-card card">
                <div className="feature-icon">
                  <i className={`fas ${f.icon}`} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="how-section">
        <div className="section-inner">
          <div className="section-label">How it works</div>
          <h2 className="section-title">Four steps to zero food waste</h2>
          <div className="steps-grid">
            {STEPS.map((s, i) => (
              <div key={s.n} className="step-card">
                <div className="step-num">{s.n}</div>
                {i < STEPS.length - 1 && <div className="step-connector" />}
                <div className="step-icon-wrap">
                  <i className={`fas ${s.icon}`} />
                </div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ALERT PREVIEW ────────────────────────────────────────── */}
      <section className="alert-section">
        <div className="section-inner alert-inner">
          <div className="alert-text">
            <div className="section-label">Notifications</div>
            <h2 className="section-title">Know before things expire</h2>
            <p>FreshTrack runs a daily check and sends you alerts at the right time — not too early, not too late.</p>
            <ul className="alert-list">
              {[
                { icon: 'fa-bell',               color: 'safe',   text: '7 days before — Plan ahead' },
                { icon: 'fa-exclamation-circle',  color: 'warn',   text: '3 days before — Use it soon' },
                { icon: 'fa-fire',                color: 'danger', text: '1 day before — Use it today' },
              ].map(a => (
                <li key={a.text} className={`alert-item alert-item--${a.color}`}>
                  <i className={`fas ${a.icon}`} />
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="alert-visual">
            <div className="notif-mock card">
              <div className="notif-mock-header">
                <i className="fas fa-envelope" /> FreshTrack Alert
              </div>
              {[
                { emoji: '🟡', text: 'Amul Milk expires in 7 days',    sub: 'Plan to use it this week' },
                { emoji: '🔴', text: 'Yoghurt expires TOMORROW',        sub: 'Use it immediately!' },
              ].map(n => (
                <div key={n.text} className="notif-item">
                  <span className="notif-emoji">{n.emoji}</span>
                  <div>
                    <strong>{n.text}</strong>
                    <small>{n.sub}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="cta-section">
        <div className="section-inner cta-inner">
          <h2>Ready to stop wasting food?</h2>
          <p>Create your free account and start tracking in under a minute.</p>
          <div className="cta-buttons">
            <button className="btn btn-primary cta-btn" onClick={onRegister}>
              <i className="fas fa-user-plus" /> Create Free Account
            </button>
            <button className="btn btn-secondary cta-btn" onClick={onLogin}>
              <i className="fas fa-sign-in-alt" /> Sign In
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="home-footer">
        <div className="home-logo" style={{ justifyContent: 'center' }}>
          <div className="home-logo-icon"><i className="fas fa-leaf" /></div>
          <span>FreshTrack</span>
        </div>
        <p>© {new Date().getFullYear()} FreshTrack · Reducing food waste one scan at a time.</p>
      </footer>

    </div>
  );
});

export default HomePage;