const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Booking = require('../models/Booking');
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

module.exports = router;
