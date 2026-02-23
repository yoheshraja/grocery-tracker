import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export const sendExpiryEmail = async (to, productName, expiryDate, daysLeft, messageType) => {
  let subject = '';
  let urgency = '';
  
  // Customize based on message type
  switch (messageType) {
    case '7 days':
      subject = `🟡 Reminder: ${productName} expires in 7 days`;
      urgency = 'in 7 days';
      break;
    case '3 days':
      subject = `🟠 Alert: ${productName} expires in 3 days`;
      urgency = 'in 3 days';
      break;
    case '1 day':
      subject = `🔴 URGENT: ${productName} expires tomorrow!`;
      urgency = 'tomorrow';
      break;
    case 'today':
      subject = `🚨 ACTION REQUIRED: ${productName} expires today!`;
      urgency = 'today';
      break;
    default:
      subject = `⚠️ Product Expiry Alert: ${productName}`;
      urgency = 'soon';
  }

  const mailOptions = {
    from: `"FreshTrack" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
        <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #4CAF50; margin-bottom: 20px;">🍎 FreshTrack Expiry Alert</h2>
          <h3 style="color: ${messageType === 'today' ? '#F44336' : messageType === '1 day' ? '#FF9800' : messageType === '3 days' ? '#FFC107' : '#4CAF50'}">
            ${subject}
          </h3>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 16px;">
              <strong>Product:</strong> ${productName}<br>
              <strong>Expiry Date:</strong> ${expiryDate}<br>
              <strong>Status:</strong> Expires ${urgency}
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6;">
            ${messageType === 'today' 
              ? '🚨 This product expires TODAY! Please use it immediately.' 
              : messageType === '1 day'
              ? '⚠️ This product expires TOMORROW! Plan to use it soon.'
              : `This product expires ${urgency}. Consider using it soon.`
            }
          </p>
          <div style="margin-top: 30px; padding: 15px; background: #E8F5E8; border-radius: 5px;">
            <p style="margin: 0; color: #2E7D32;">
              💡 <strong>Tip:</strong> Check your FreshTrack dashboard for more details and manage your inventory.
            </p>
          </div>
          <p style="margin-top: 30px; color: #666; font-size: 14px;">
            This is an automated message from FreshTrack. Please do not reply.<br>
            Manage your notification preferences in your account settings.
          </p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Email send error:', error);
    return { success: false, error: error.message };
  }
};