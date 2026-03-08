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
      guestPhone: guestPhone ? String(guestPhone).replace(/^\+/, '') : guestPhone,
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
    res.json(booking.toObject());
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, paymentStatus, paymentMethod } = req.body;
    const allowedStatuses = ['pending', 'confirmed', 'checked-in', 'checked-out', 'cancelled'];
    const allowedPaymentStatuses = ['pending', 'paid', 'failed'];
    const allowedPaymentMethods = ['cash', 'online', ''];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    if (paymentStatus && !allowedPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({ message: 'Invalid payment status' });
    }
    if (paymentMethod && !allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ message: 'Invalid payment method' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    // Prevent status change after approval or rejection
    if (booking.status === 'confirmed' && status === 'cancelled') {
      return res.status(400).json({ message: 'Booking is already Confirmed and cannot be rejected.' });
    }
    if (booking.status === 'cancelled' && status === 'confirmed') {
      return res.status(400).json({ message: 'Booking is already Cancelled and cannot be approved.' });
    }
    const previousStatus = booking.status;
    booking.status = status;
    if (paymentStatus) booking.paymentStatus = paymentStatus;
    if (paymentMethod) booking.paymentMethod = paymentMethod;
    await booking.save();

    // Create in-app notifications for user based on status change
    try {
      const Notification = require('../../models/Notification');
      if (status === 'confirmed' && previousStatus !== 'confirmed') {
        await Notification.create({
          userId: booking.userId,
          title: 'Booking Confirmed',
          message: `Your booking has been confirmed. Check-in: ${new Date(booking.checkIn).toLocaleDateString()}.`,
          role: 'user',
        });
      } else if (status === 'cancelled' && previousStatus !== 'cancelled') {
        await Notification.create({
          userId: booking.userId,
          title: 'Booking Cancelled',
          message: `Your booking has been cancelled. Please contact us if you have questions.`,
          role: 'user',
        });
      } else if (status === 'checked-in' && previousStatus !== 'checked-in') {
        await Notification.create({
          userId: booking.userId,
          title: 'Checked In',
          message: `You have successfully checked in. Enjoy your stay!`,
          role: 'user',
        });
      } else if (status === 'checked-out' && previousStatus !== 'checked-out') {
        await Notification.create({
          userId: booking.userId,
          title: 'Checked Out',
          message: `You have checked out. Thank you for staying with us!`,
          role: 'user',
        });
      }
      // In-app notification for payment received
      if (paymentStatus === 'paid' && previousStatus !== 'paid') {
        await Notification.create({
          userId: booking.userId,
          title: 'Payment Received',
          message: `Your payment of $${booking.totalPrice} has been received. Thank you!`,
          role: 'user',
        });
      }
    } catch (err) {
      console.warn('Failed to create in-app notification:', err);
    }

    // Send email notifications based on status change
    try {
      const emailService = require('../../utils/emailService');
      if (status === 'confirmed' && previousStatus !== 'confirmed') {
        await emailService.sendBookingConfirmation(booking);
      } else if (status === 'cancelled' && previousStatus !== 'cancelled') {
        await emailService.sendBookingCancellation(booking);
      } else if (status === 'checked-in' && previousStatus !== 'checked-in') {
        await emailService.sendCheckInNotification(booking);
      } else if (status === 'checked-out' && previousStatus !== 'checked-out') {
        await emailService.sendCheckOutNotification(booking);
      }
      // Send payment notification if payment status changed to paid
      if (paymentStatus === 'paid' && booking.paymentStatus === 'paid') {
        await emailService.sendPaymentConfirmation(booking);
        await emailService.sendPaymentReceivedAdminNotification(booking, false);
      }
    } catch (err) {
      console.warn('Failed to send email notification:', err);
    }

    res.json(booking.toObject());
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

    // Notify user that admin has updated ID proof
    try {
      const Notification = require('../../models/Notification');
      await Notification.create({
        userId: booking.userId,
        title: 'ID Proof Updated',
        message: 'Your ID proof has been updated by admin. Awaiting approval.',
        role: 'user',
      });
    } catch (err) {
      console.warn('Failed to create user notification:', err);
    }

    res.json(booking.toObject());
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/bookings - Get all bookings (admin only)
// GET /api/admin/bookings-ids - List all booking IDs (admin only, debug)
router.get('/booking-ids', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const bookings = await Booking.find({}, { _id: 1 }).lean();
    const ids = bookings.map(b => b._id);
    res.json({ bookingIds: ids });
  } catch (err) {
    next(err);
  }
});
// GET /api/admin/bookings/:id - Get booking by ID (admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    console.log('Admin booking fetch:', req.params.id);
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) {
      console.log('Booking not found for ID:', req.params.id);
      return res.status(404).json({ message: 'Booking not found' });
    }
    console.log('Booking found:', booking);
    res.json(booking.toObject());
  } catch (err) {
    console.error('Error fetching booking:', err);
    next(err);
  }
});
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // Always include guestPhone in the response
    const bookings = await Booking.find().lean();
    const bookingsWithPhone = bookings.map(b => ({
      ...b,
      guestPhone: b.guestPhone || '',
    }));
    res.json(bookingsWithPhone);
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

