const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: String, default: '' }, // empty for admin/global
  title: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  role: { type: String, enum: ['user', 'admin', 'all'], default: 'all' },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
