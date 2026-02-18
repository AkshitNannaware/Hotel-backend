const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ['dining', 'restaurant', 'spa', 'bar'], required: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    video: { type: String, default: '' },
    priceRange: { type: String, default: '' },
    availableTimes: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Service', serviceSchema);
