const mongoose = require('mongoose');

const deletedItemSchema = new mongoose.Schema({
  itemType: { type: String, enum: ['room', 'service', 'booking', 'serviceBooking', 'offer', 'contact'], required: true },
  itemId: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  deletedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  adminId: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('DeletedItem', deletedItemSchema);
