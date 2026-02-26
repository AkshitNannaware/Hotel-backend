const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Booking = require('../models/Booking');
const ServiceBooking = require('../models/ServiceBooking');
const { requireDb } = require('../middleware/requireDb');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireDb, requireAuth);

const getRazorpayClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    const err = new Error('Razorpay keys are not configured');
    err.status = 500;
    throw err;
  }

  return { client: new Razorpay({ key_id: keyId, key_secret: keySecret }), keySecret };
};

// POST /api/payments/razorpay/order
router.post('/razorpay/order', async (req, res, next) => {
  try {
    const { bookingId } = req.body || {};
    if (!bookingId) {
      return res.status(400).json({ message: 'bookingId is required' });
    }

    const booking = await Booking.findById(bookingId).lean();
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'Cancelled bookings cannot be paid' });
    }

    if (booking.idVerified !== 'approved') {
      return res.status(400).json({ message: 'ID verification is required before payment' });
    }

    const amount = Math.round(Number(booking.totalPrice) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid booking amount' });
    }

    const { client } = getRazorpayClient();
    const order = await client.orders.create({
      amount,
      currency: 'INR',
      receipt: `booking_${booking._id}`,
      notes: {
        bookingId: booking._id.toString(),
        userId: req.user.id,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      bookingId: booking._id.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/razorpay/verify
router.post('/razorpay/verify', async (req, res, next) => {
  try {
    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing Razorpay verification fields' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'Cancelled bookings cannot be paid' });
    }

    const { keySecret } = getRazorpayClient();
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid Razorpay signature' });
    }

    booking.paymentStatus = 'paid';
    booking.paymentMethod = 'online';
    await booking.save();

    // Send email notifications
    try {
      const emailService = require('../utils/emailService');
      // Send to user - payment confirmation
      await emailService.sendPaymentConfirmation(booking);
      // Send to admin - payment received
      await emailService.sendPaymentReceivedAdminNotification(booking, false);
    } catch (err) {
      console.warn('Failed to send email notifications:', err);
    }

    res.json({ status: 'verified', paymentId: razorpay_payment_id });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/razorpay/service-order
router.post('/razorpay/service-order', async (req, res, next) => {
  try {
    const { serviceBookingId } = req.body || {};
    if (!serviceBookingId) {
      return res.status(400).json({ message: 'serviceBookingId is required' });
    }

    const serviceBooking = await ServiceBooking.findById(serviceBookingId).lean();
    if (!serviceBooking) {
      return res.status(404).json({ message: 'Service booking not found' });
    }

    if (serviceBooking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (serviceBooking.status === 'cancelled') {
      return res.status(400).json({ message: 'Cancelled service bookings cannot be paid' });
    }

    // Prefer numeric totalPrice; otherwise, derive from priceRange and guests
    let amountInPaise = 0;

    const numericTotal = Number(serviceBooking.totalPrice);
    if (Number.isFinite(numericTotal) && numericTotal > 0) {
      amountInPaise = Math.round(numericTotal * 100);
    } else if (serviceBooking.priceRange) {
      // Strip currency symbols/text (e.g. "₹200-500" -> "200500" then choose lower bound)
      const cleaned = String(serviceBooking.priceRange)
        .split('-')[0] // take lower end of range if present
        .replace(/[^0-9.]/g, '');
      const base = Number(cleaned);
      const guests = Number(serviceBooking.guests || 1);
      if (Number.isFinite(base) && base > 0 && Number.isFinite(guests) && guests > 0) {
        const total = base * guests;
        amountInPaise = Math.round(total * 100);
      }
    }

    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      // As a final fallback, use a safe default amount per guest to avoid blocking payment
      const guests = Number(serviceBooking.guests || 1);
      const perGuestFallback = 100; // ₹100 per guest
      const totalFallback = perGuestFallback * (Number.isFinite(guests) && guests > 0 ? guests : 1);
      amountInPaise = Math.round(totalFallback * 100);
      console.warn('Falling back to default service booking amount', {
        serviceBookingId: serviceBooking._id?.toString?.() || serviceBookingId,
        originalTotalPrice: serviceBooking.totalPrice,
        originalPriceRange: serviceBooking.priceRange,
        guests: serviceBooking.guests,
      });
    }

    const { client } = getRazorpayClient();
    const order = await client.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `service_booking_${serviceBooking._id}`,
      notes: {
        serviceBookingId: serviceBooking._id.toString(),
        userId: req.user.id,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      serviceBookingId: serviceBooking._id.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/razorpay/service-verify
router.post('/razorpay/service-verify', async (req, res, next) => {
  try {
    const { serviceBookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!serviceBookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing Razorpay verification fields' });
    }

    const serviceBooking = await ServiceBooking.findById(serviceBookingId);
    if (!serviceBooking) {
      return res.status(404).json({ message: 'Service booking not found' });
    }

    if (serviceBooking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (serviceBooking.status === 'cancelled') {
      return res.status(400).json({ message: 'Cancelled service bookings cannot be paid' });
    }

    const { keySecret } = getRazorpayClient();
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid Razorpay signature' });
    }

    serviceBooking.status = 'confirmed';
    serviceBooking.paymentStatus = 'paid';
    serviceBooking.paymentMethod = 'online';
    await serviceBooking.save();

    // Send email notifications
    try {
      const emailService = require('../utils/emailService');
      // Send to user - service payment confirmation
      await emailService.sendServicePaymentConfirmation(serviceBooking);
      // Send to admin - payment received
      await emailService.sendPaymentReceivedAdminNotification(serviceBooking, true);
    } catch (err) {
      console.warn('Failed to send email notifications:', err);
    }

    res.json({ status: 'verified', paymentId: razorpay_payment_id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
