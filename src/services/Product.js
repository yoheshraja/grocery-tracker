const productSchema = new mongoose.Schema({
  name: String,
  expiryDate: Date,
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Track which notifications have been sent
  notificationsSent: {
    sevenDays: {
      type: Boolean,
      default: false
    },
    threeDays: {
      type: Boolean,
      default: false
    },
    oneDay: {
      type: Boolean,
      default: false
    },
    expired: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true
}); 