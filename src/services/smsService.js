import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const sendExpirySMS = async (phone, productName, expiryDate, daysLeft, messageType) => {
  let emoji = '⚠️';
  let urgency = '';
  
  switch (messageType) {
    case '7 days':
      emoji = '🟡';
      urgency = 'in 7 days';
      break;
    case '3 days':
      emoji = '🟠';
      urgency = 'in 3 days';
      break;
    case '1 day':
      emoji = '🔴';
      urgency = 'TOMORROW';
      break;
    case 'today':
      emoji = '🚨';
      urgency = 'TODAY';
      break;
  }

  const message = `${emoji} FreshTrack Alert!
Product: ${productName}
Expires: ${urgency}
Date: ${expiryDate}

Check your dashboard: ${process.env.FRONTEND_URL || 'https://your-app.com'}`;

  try {
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE,
      to: phone
    });
    
    console.log(`📱 SMS sent to ${phone}: ${result.sid}`);
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error('❌ SMS send error:', error.message);
    return { success: false, error: error.message };
  }
};