const mongoose = require('mongoose');

const passwordResetOtpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  identifier: {
    type: String,
    required: true,
  },
  channel: {
    type: String,
    enum: ['email', 'sms'],
    required: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  resetTokenHash: {
    type: String,
    default: null,
  },
  verifiedAt: {
    type: Date,
    default: null,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
}, { timestamps: true });

passwordResetOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordResetOtp', passwordResetOtpSchema);
