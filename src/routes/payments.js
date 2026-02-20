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
    await booking.save();

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

    // Use totalPrice if available, else fallback to priceRange (parse as number)
    let amount = 0;
    if (serviceBooking.totalPrice) {
      amount = Math.round(Number(serviceBooking.totalPrice) * 100);
    } else if (serviceBooking.priceRange) {
      amount = Math.round(Number(serviceBooking.priceRange) * 100);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid service booking amount' });
    }

    const { client } = getRazorpayClient();
    const order = await client.orders.create({
      amount,
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
    await serviceBooking.save();

    res.json({ status: 'verified', paymentId: razorpay_payment_id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
