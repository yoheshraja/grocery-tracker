FreshTrack — Grocery Expiry Tracker

A web app that tracks grocery expiry dates and sends automated alerts before products expire — reducing food waste and saving money.

Tech Stack:
Frontend — React.js, ZXing, Tesseract.js
Backend — Node.js, Express.js, MongoDB Atlas
Notifications — Nodemailer, Twilio
Auth — JWT, bcrypt

How It Works:
Register / Login — User creates an account and logs in securely.
Scan Barcode — User scans a product barcode to automatically get product details.
Read Expiry Date — User captures the expiry date, which is automatically detected.
Save Product — Product details and expiry date are saved.
Dashboard— Products are displayed with clear expiry status.
Automatic Alerts — Users receive email notifications before products expire.
Take Action— Users can use or dispose of products before expiry, helping reduce food waste.

Features:
Scan product barcode using camera — auto-fills product details
Photograph expiry label — OCR reads the date automatically
Email alerts at 7 days, 3 days, and 1 day before expiry
Dashboard with green, amber, red expiry status
Secure login with JWT and OTP password recovery
Dark and light theme support

Future Plans:
Customizable alert intervals per product category
Smart suggestions for products nearing expiry
Native mobile app for Android and iOS
