const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Booking = require('../../models/Booking');
const { requireDb } = require('../../middleware/requireDb');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

router.use(requireDb);

const uploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'ids');
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
    userId = '1',
  } = req.body;

  try {
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
      userId,
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
    const bookings = await Booking.find().lean();
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

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/bookings/:id/id-proof
router.patch('/:id/id-proof', requireAuth, requireAdmin, upload.single('idProof'), async (req, res, next) => {
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

// GET /api/admin/bookings - Get all bookings (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const bookings = await Booking.find().lean();
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/bookings/bulk-import
// Import bookings from JSON file (admin only)
router.post('/bulk-import', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { bookings } = req.body;

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return res.status(400).json({ message: 'Bookings array is required and cannot be empty' });
    }

    // Validate and transform bookings
    const validBookings = bookings.map((booking) => ({
      roomId: booking.roomId,
      checkIn: new Date(booking.checkIn),
      checkOut: new Date(booking.checkOut),
      guests: booking.guests || 1,
      rooms: booking.rooms || 1,
      totalPrice: booking.totalPrice || 0,
      roomPrice: booking.roomPrice || 0,
      taxes: booking.taxes || 0,
      serviceCharges: booking.serviceCharges || 0,
      userId: booking.userId || '1',
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      guestPhone: booking.guestPhone,
      status: booking.status || 'confirmed',
      paymentStatus: booking.paymentStatus || 'pending',
      idVerified: booking.idVerified || 'pending',
      idProofUrl: booking.idProofUrl,
      idProofType: booking.idProofType,
      idProofUploadedAt: booking.idProofUploadedAt,
      bookingDate: booking.bookingDate || new Date(),
    }));

    // Insert bookings
    const insertedBookings = await Booking.insertMany(validBookings);

    res.json({
      success: true,
      count: insertedBookings.length,
      message: `Successfully imported ${insertedBookings.length} bookings`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

