const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['Single', 'Double', 'Suite', 'Deluxe'], required: true },
    price: { type: Number, required: true },
    images: { type: [String], default: [] },
    video: { type: String, default: '' },
    description: { type: String, default: '' },
    amenities: { type: [String], default: [] },
    maxGuests: { type: Number, default: 1 },
    size: { type: Number, default: 0 },
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Room', roomSchema);
