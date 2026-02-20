const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Booking = require('../models/Booking');
const PDFDocument = require('pdfkit');
// GET /api/bookings/:id/invoice - Download invoice PDF for a booking
router.get('/:id/invoice', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-room-${booking._id}.pdf`);
    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(20).text('Hotel Booking Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Invoice ID: ${booking._id}`);
    doc.text(`Guest Name: ${booking.guestName}`);
    doc.text(`Guest Email: ${booking.guestEmail}`);
    doc.text(`Guest Phone: ${booking.guestPhone}`);
    doc.text(`Room ID: ${booking.roomId}`);
    doc.text(`Check-In: ${new Date(booking.checkIn).toLocaleDateString()}`);
    doc.text(`Check-Out: ${new Date(booking.checkOut).toLocaleDateString()}`);
    doc.text(`Guests: ${booking.guests}`);
    doc.text(`Rooms: ${booking.rooms}`);
    doc.text(`Status: ${booking.status}`);
    doc.text(`Payment Status: ${booking.paymentStatus}`);
    doc.moveDown();
    doc.text(`Room Price: ₹${booking.roomPrice}`);
    doc.text(`Taxes: ₹${booking.taxes}`);
    doc.text(`Service Charges: ₹${booking.serviceCharges}`);
    doc.font('Helvetica-Bold').text(`Total: ₹${booking.totalPrice}`);
    doc.end();
  } catch (err) {
    next(err);
  }
});
const { requireDb } = require('../middleware/requireDb');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'ids');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext.toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `id-${unique}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  },
});

router.use(requireDb, requireAuth);

const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'checked-in'];

const findNextAvailableRoomDates = async (roomId, checkInDate, checkOutDate) => {
  const durationMs = checkOutDate.getTime() - checkInDate.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { checkInDate, checkOutDate };
  }

  let nextCheckIn = new Date(checkInDate);
  let nextCheckOut = new Date(checkOutDate);

  for (let i = 0; i < 50; i += 1) {
    const overlaps = await Booking.find({
      roomId,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      cancelledAt: { $exists: false },
      checkIn: { $lt: nextCheckOut },
      checkOut: { $gt: nextCheckIn },
    })
      .select({ checkOut: 1 })
      .lean();

    if (!overlaps.length) {
      break;
    }

    const latestCheckOut = overlaps.reduce((latest, booking) => {
      const bookingCheckOut = new Date(booking.checkOut);
      return bookingCheckOut > latest ? bookingCheckOut : latest;
    }, new Date(nextCheckOut));

    nextCheckIn = new Date(latestCheckOut);
    nextCheckOut = new Date(latestCheckOut.getTime() + durationMs);
  }

  return { checkInDate: nextCheckIn, checkOutDate: nextCheckOut };
};

// Shape is based on BookingContext Booking interface
// POST /api/bookings
router.post('/', async (req, res, next) => {
  const {
    roomId,
    checkIn,
    checkOut,
    guests,
    rooms,
    totalPrice,
    roomPrice,
    taxes,
    serviceCharges,
    guestName,
    guestEmail,
    guestPhone,
  } = req.body;

  try {
    if (req.user?.role === 'admin') {
      return res.status(403).json({ message: 'Admins cannot create bookings' });
    }

    let checkInDate = new Date(checkIn);
    let checkOutDate = new Date(checkOut);

    const existingBooking = await Booking.findOne({
      roomId,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      cancelledAt: { $exists: false },
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate },
    }).lean();

    if (existingBooking) {
      const adjusted = await findNextAvailableRoomDates(roomId, checkInDate, checkOutDate);
      checkInDate = adjusted.checkInDate;
      checkOutDate = adjusted.checkOutDate;
    }

    const numericFields = [
      { name: 'guests', value: guests },
      { name: 'rooms', value: rooms },
      { name: 'totalPrice', value: totalPrice },
      { name: 'roomPrice', value: roomPrice },
      { name: 'taxes', value: taxes },
      { name: 'serviceCharges', value: serviceCharges },
    ];

    const missingRequired =
      !roomId ||
      !checkIn ||
      !checkOut ||
      !guestName ||
      !guestEmail ||
      !guestPhone ||
      numericFields.some((field) =>
        field.value === '' || field.value === null || field.value === undefined || !Number.isFinite(Number(field.value))
      );

    if (missingRequired) {
      return res.status(400).json({ message: 'Missing required booking fields' });
    }

    const booking = await Booking.create({
      roomId,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guests,
      rooms,
      totalPrice,
      roomPrice,
      taxes,
      serviceCharges,
      userId: req.user.id,
      guestName,
      guestEmail,
      guestPhone,
      status: 'confirmed',
      paymentStatus: 'pending',
      bookingDate: new Date(),
    });

    res.status(201).json(booking);
  } catch (err) {
    next(err);
      // Create notification for booking
      const Notification = require('../models/Notification');
      await Notification.create({
        userId: req.user.id,
        title: 'Booking Confirmed',
        message: `Your booking for room ${roomId} is confirmed from ${checkInDate.toDateString()} to ${checkOutDate.toDateString()}.`,
        role: 'user',
      });
  }
});

// GET /api/bookings
router.get('/', async (req, res, next) => {
  try {
    const bookings = await Booking.find({ userId: req.user.id }).lean();
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['pending', 'confirmed', 'checked-in', 'checked-out', 'cancelled'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (status === 'checked-in' && booking.idVerified !== 'approved') {
      return res.status(400).json({ message: 'ID verification is required before check-in' });
    }

    booking.status = status;
    booking.cancelledAt = status === 'cancelled' ? new Date() : undefined;
    await booking.save();
      // Create notification for status change
      const Notification = require('../models/Notification');
      let notifTitle = '', notifMsg = '';
      if (status === 'cancelled') {
        notifTitle = 'Booking Cancelled';
        notifMsg = `Your booking for room ${booking.roomId} has been cancelled.`;
      } else if (status === 'checked-in') {
        notifTitle = 'Checked In';
        notifMsg = `You have checked in to room ${booking.roomId}.`;
      } else if (status === 'checked-out') {
        notifTitle = 'Checked Out';
        notifMsg = `You have checked out from room ${booking.roomId}.`;
      }
      if (notifTitle) {
        await Notification.create({
          userId: booking.userId,
          title: notifTitle,
          message: notifMsg,
          role: 'user',
        });
      }
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/id-proof
router.patch('/:id/id-proof', upload.single('idProof'), async (req, res, next) => {
  try {
    const { idType } = req.body;
    if (!idType) {
      return res.status(400).json({ message: 'ID type is required' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'ID proof file is required' });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    booking.idProofUrl = `/uploads/ids/${req.file.filename}`;
    booking.idProofType = idType;
    booking.idProofUploadedAt = new Date();
    booking.idVerified = 'pending';
    await booking.save();
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/payment-status
router.patch('/:id/payment-status', async (req, res, next) => {
  try {
    const { paymentStatus } = req.body;
    const allowedStatuses = ['pending', 'paid', 'failed'];

    if (!allowedStatuses.includes(paymentStatus)) {
      return res.status(400).json({ message: 'Invalid payment status' });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    booking.paymentStatus = paymentStatus;
    await booking.save();
      // Create notification for payment status
      const Notification = require('../models/Notification');
      let notifTitle = '', notifMsg = '';
      if (paymentStatus === 'paid') {
        notifTitle = 'Payment Successful';
        notifMsg = `Payment for booking ${booking._id} was successful.`;
      } else if (paymentStatus === 'failed') {
        notifTitle = 'Payment Failed';
        notifMsg = `Payment for booking ${booking._id} failed.`;
      }
      if (notifTitle) {
        await Notification.create({
          userId: booking.userId,
          title: notifTitle,
          message: notifMsg,
          role: 'user',
        });
      }
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

