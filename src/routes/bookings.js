const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Booking = require('../models/Booking');
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
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

