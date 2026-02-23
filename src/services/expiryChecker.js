import cron from 'node-cron';
import { differenceInDays } from 'date-fns';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { sendExpiryEmail } from './emailService.js';
import { sendExpirySMS } from './smsService.js';

// Helper function to check if notification should be sent
const shouldSendNotification = (product, daysLeft) => {
  // Check if notification already sent for this day
  if (daysLeft === 7 && !product.notificationsSent.sevenDays) {
    return 'sevenDays';
  }
  if (daysLeft === 3 && !product.notificationsSent.threeDays) {
    return 'threeDays';
  }
  if (daysLeft === 1 && !product.notificationsSent.oneDay) {
    return 'oneDay';
  }
  if (daysLeft === 0 && !product.notificationsSent.expired) {
    return 'expired';
  }
  return null;
};

// Update product notification status
const updateNotificationStatus = (product, notificationType) => {
  switch (notificationType) {
    case 'sevenDays':
      product.notificationsSent.sevenDays = true;
      break;
    case 'threeDays':
      product.notificationsSent.threeDays = true;
      break;
    case 'oneDay':
      product.notificationsSent.oneDay = true;
      break;
    case 'expired':
      product.notificationsSent.expired = true;
      break;
  }
  return product;
};

// Schedule job to run daily at 9 AM
cron.schedule('0 9 * * *', async () => {
  console.log('🔔 Running expiry notification job at', new Date().toISOString());

  try {
    // Get all products that haven't had all notifications sent
    const products = await Product.find({
      $or: [
        { 'notificationsSent.sevenDays': false },
        { 'notificationsSent.threeDays': false },
        { 'notificationsSent.oneDay': false },
        { 'notificationsSent.expired': false }
      ]
    }).populate('userId');

    console.log(`📊 Checking ${products.length} products for notifications`);

    let notificationsCount = 0;

    for (const product of products) {
      if (!product.userId) continue;

      const expiryDate = new Date(product.expiryDate);
      const today = new Date();
      
      // Calculate days left (ceiling to get whole days)
      const daysLeft = Math.ceil(differenceInDays(expiryDate, today));

      // Check if we should send notification
      const notificationType = shouldSendNotification(product, daysLeft);
      
      if (notificationType) {
        const user = product.userId;
        let messageType = '';
        
        // Customize message based on notification type
        switch (notificationType) {
          case 'sevenDays':
            messageType = '7 days';
            break;
          case 'threeDays':
            messageType = '3 days';
            break;
          case 'oneDay':
            messageType = '1 day';
            break;
          case 'expired':
            messageType = 'today';
            break;
        }

        // Send email notification
        if (user.email) {
          await sendExpiryEmail(
            user.email,
            product.name,
            expiryDate.toDateString(),
            daysLeft,
            messageType
          );
        }

        // Send SMS notification
        if (user.phone) {
          await sendExpirySMS(
            user.phone,
            product.name,
            expiryDate.toDateString(),
            daysLeft,
            messageType
          );
        }

        // Update notification status
        updateNotificationStatus(product, notificationType);
        await product.save();
        
        notificationsCount++;
        console.log(`✅ Sent ${messageType} notification for "${product.name}"`);
      }
    }

    console.log(`📨 Sent ${notificationsCount} notifications in total`);
  } catch (error) {
    console.error('❌ Error in expiry notification job:', error);
  }
});

// Optional: Function to reset notifications (for testing)
export const resetProductNotifications = async (productId) => {
  try {
    await Product.findByIdAndUpdate(productId, {
      'notificationsSent.sevenDays': false,
      'notificationsSent.threeDays': false,
      'notificationsSent.oneDay': false,
      'notificationsSent.expired': false
    });
    console.log(`🔄 Reset notifications for product ${productId}`);
  } catch (error) {
    console.error('Error resetting notifications:', error);
  }
};

export default cron;