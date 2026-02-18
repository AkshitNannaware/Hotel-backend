const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '' },
    description: { type: String, default: '' },
    price: { type: Number, default: 0 },
    rating: { type: Number, default: 4.9 },
    reviewCount: { type: Number, default: 0 },
    badgeText: { type: String, default: '' },
    expiryDate: { type: Date, default: null },
    ctaText: { type: String, default: 'Check availability' },
    image: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Offer', offerSchema);
