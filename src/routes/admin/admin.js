const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Booking = require('../../models/Booking');
const Room = require('../../models/Room');
const Service = require('../../models/Service');
const User = require('../../models/User');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const { requireDb } = require('../../middleware/requireDb');

const router = express.Router();

router.use(requireDb, requireAuth, requireAdmin);

// Setup multer for room image uploads
const roomImagesDir = path.join(__dirname, '..', '..', '..', 'uploads', 'rooms');
fs.mkdirSync(roomImagesDir, { recursive: true });

const roomImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, roomImagesDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext.toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `room-${unique}${safeExt}`);
  },
});

const uploadRoomImages = multer({
  storage: roomImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
    cb(null, true);
  },
});

// Setup multer for room video uploads
const roomVideosDir = path.join(__dirname, '..', '..', '..', 'uploads', 'rooms', 'videos');
fs.mkdirSync(roomVideosDir, { recursive: true });

const roomVideoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, roomVideosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext.toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `room-video-${unique}${safeExt}`);
  },
});

const uploadRoomVideo = multer({
  storage: roomVideoStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only MP4, WebM, OGG, and MOV videos are allowed.'));
    }
    cb(null, true);
  },
});

// GET /api/admin/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [totalRooms, availableRooms, totalBookings, confirmedBookings, bookings] =
      await Promise.all([
        Room.countDocuments(),
        Room.countDocuments({ available: true }),
        Booking.countDocuments(),
        Booking.countDocuments({ status: 'confirmed' }),
        Booking.find({}, { totalPrice: 1, status: 1 }).lean(),
      ]);

    const totalRevenue = bookings.reduce((sum, booking) => sum + (booking.totalPrice || 0), 0);
    const occupiedCount = bookings.filter((b) => b.status === 'confirmed' || b.status === 'checked-in').length;

    const stats = {
      totalRooms,
      availableRooms,
      totalBookings,
      confirmedBookings,
      totalRevenue,
      occupancyRate: totalRooms === 0 ? 0 : Number(((occupiedCount / totalRooms) * 100).toFixed(1)),
    };

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Rooms CRUD
router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await Room.find().lean();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

router.post('/rooms', async (req, res, next) => {
  try {
    const room = await Room.create(req.body);
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
});

router.put('/rooms/:id', async (req, res, next) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    res.json(room);
  } catch (err) {
    next(err);
  }
});

router.delete('/rooms/:id', async (req, res, next) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    res.json({ message: 'Room deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/rooms/:id/upload-images - Upload room images
router.post('/rooms/:id/upload-images', uploadRoomImages.array('images', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images uploaded' });
    }

    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Generate URLs for uploaded images
    const imageUrls = req.files.map((file) => `/uploads/rooms/${file.filename}`);
    
    // Replace default Unsplash images with uploaded ones, otherwise append
    const hasDefaultImage = room.images.some(img => img.includes('unsplash.com'));
    if (hasDefaultImage) {
      // Replace default image with uploaded images
      room.images = imageUrls;
    } else {
      // Append to existing custom images
      room.images = [...room.images, ...imageUrls];
    }
    await room.save();

    res.json({
      message: 'Images uploaded successfully',
      images: imageUrls,
      room,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/rooms/:id/upload-video - Upload room video
router.post('/rooms/:id/upload-video', uploadRoomVideo.single('video'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video uploaded' });
    }

    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    room.video = `/uploads/rooms/videos/${req.file.filename}`;
    await room.save();

    res.json({
      message: 'Video uploaded successfully',
      video: room.video,
      room,
    });
  } catch (err) {
    next(err);
  }
});

// Services CRUD
router.get('/services', async (req, res, next) => {
  try {
    const services = await Service.find().lean();
    res.json(services);
  } catch (err) {
    next(err);
  }
});

router.post('/services', async (req, res, next) => {
  try {
    const service = await Service.create(req.body);
    res.status(201).json(service);
  } catch (err) {
    next(err);
  }
});

router.put('/services/:id', async (req, res, next) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    res.json(service);
  } catch (err) {
    next(err);
  }
});

router.delete('/services/:id', async (req, res, next) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    res.json({ message: 'Service deleted' });
  } catch (err) {
    next(err);
  }
});

// Bookings list and status update
router.get('/bookings', async (req, res, next) => {
  try {
    const bookings = await Booking.find().lean();
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

router.patch('/bookings/:id/status', async (req, res, next) => {
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

router.patch('/bookings/:id/id-verified', async (req, res, next) => {
  try {
    const { idVerified } = req.body;
    const allowed = ['pending', 'approved', 'rejected'];

    if (!allowed.includes(idVerified)) {
      return res.status(400).json({ message: 'Invalid ID verification status' });
    }

    const existingBooking = await Booking.findById(req.params.id);
    if (!existingBooking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (existingBooking.idVerified === 'approved' && idVerified !== 'approved') {
      return res.status(400).json({ message: 'Approved ID verification cannot be changed' });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { idVerified },
      { new: true, runValidators: true }
    );

    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// Users list and role update
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find({}, { passwordHash: 0 }).lean();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true, select: '-passwordHash' }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

