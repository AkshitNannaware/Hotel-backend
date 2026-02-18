const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    guests: { type: Number, required: true },
    rooms: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    roomPrice: { type: Number, required: true },
    taxes: { type: Number, required: true },
    serviceCharges: { type: Number, required: true },
    userId: { type: String, default: '' },
    guestName: { type: String, required: true },
    guestEmail: { type: String, required: true },
    guestPhone: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'checked-in', 'checked-out', 'cancelled'],
      default: 'confirmed',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    idVerified: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    idProofUrl: { type: String, default: '' },
    idProofType: { type: String, default: '' },
    idProofUploadedAt: { type: Date },
    bookingDate: { type: Date, default: Date.now },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);
