const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || '';
const { requireAuth, requireAdmin } = require('../../middleware/auth');

router.post('/admin-signup', async (req, res) => {
  try {
    const { name, email, phone, password, secret } = req.body;
    // Optional: Check secret/invite code
    if (!secret || secret !== process.env.ADMIN_SIGNUP_SECRET) {
      return res.status(403).json({ message: 'Invalid admin secret.' });
    }
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({ message: 'Name, password, and email or phone are required' });
    }
    const normalizedEmail = email ? String(email).trim().toLowerCase() : '';
    const normalizedPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const orQuery = [];
    if (normalizedEmail) orQuery.push({ email: normalizedEmail });
    if (normalizedPhone) orQuery.push({ phone: normalizedPhone });
    const existing = orQuery.length ? await User.findOne({ $or: orQuery }) : null;
    if (existing) {
      return res.status(409).json({ message: 'User already exists with this email or phone' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email: normalizedEmail || undefined,
      phone: normalizedPhone || undefined,
      role: 'admin',
      passwordHash,
    });
    // Issue JWT
    const token = jwt.sign({ id: newUser._id, role: 'admin', name: newUser.name, email: newUser.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(201).json({
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        twoFactorEnabled: newUser.twoFactorEnabled,
      },
      token,
      message: 'Admin created successfully',
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create admin', error: err.message });
  }
});
// POST /api/admin/users - Admin creates a new user
// ...existing code...
router.post('/users', async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({ message: 'Name, password, and email or phone are required' });
    }
    // Normalize email/phone
    const normalizedEmail = email ? String(email).trim().toLowerCase() : '';
    const normalizedPhone = phone ? String(phone).replace(/\D/g, '') : '';
    // Check for existing user
      const token = jwt.sign({
        id: newUser._id.toString(),
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        name: newUser.name
      }, JWT_SECRET, { expiresIn: '24h' });
    if (normalizedEmail) orQuery.push({ email: normalizedEmail });
    if (normalizedPhone) orQuery.push({ phone: normalizedPhone });
    const existing = orQuery.length ? await User.findOne({ $or: orQuery }) : null;
    if (existing) {
      return res.status(409).json({ message: 'User already exists with this email or phone' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email: normalizedEmail || undefined,
      phone: normalizedPhone || undefined,
      role: 'user',
      passwordHash,
    });

    // Send welcome email if email is provided and SendGrid is configured
    if (normalizedEmail && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
      try {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.send({
          to: normalizedEmail,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: 'Welcome to Hotel Management',
          text: `Hello ${name},\n\nYour account has been created by the admin.\n\nLogin email: ${normalizedEmail}\nPassword: (the password you provided to admin)\n\nPlease log in and change your password after first login.`,
        });
      } catch (err) {
        // Log but do not fail user creation if email fails
        console.error('Failed to send welcome email:', err);
      }
    }

    res.status(201).json({
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        twoFactorEnabled: newUser.twoFactorEnabled,
      },
      message: 'User created successfully',
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/profile - update admin profile (name, email, phone)
router.patch('/profile', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      console.error('PATCH /api/admin/profile: req.user missing or invalid. Auth header:', req.headers.authorization);
      return res.status(401).json({ message: 'Unauthorized: user not found in request. Please log in again.' });
    }
    const userId = req.user.id;
    const { name, email, phone, logoUrl, facebook, instagram, youtube, twitter } = req.body;
    const update = {};
    if (name) update.name = name;
    if (email) update.email = email;
    if (phone) update.phone = phone;
    if (logoUrl) update.logoUrl = logoUrl;
    if (facebook) update.facebook = facebook;
    if (instagram) update.instagram = instagram;
    if (youtube) update.youtube = youtube;
    if (twitter) update.twitter = twitter;
    const user = await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true, select: '-passwordHash' });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});
// PATCH /api/admin/profile/password - update admin password
router.patch('/profile/password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    console.log('PATCH /api/admin/profile/password: req.user =', req.user);
    if (!req.user || !req.user.id) {
      console.error('PATCH /api/admin/profile/password: req.user missing or invalid. Auth header:', req.headers.authorization);
      return res.status(401).json({ message: 'Unauthorized: user not found in request. Please log in again.' });
    }
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password required' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Check current password
    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    // Update password
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await user.save();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Booking = require('../../models/Booking');
const Room = require('../../models/Room');
const Service = require('../../models/Service');
const User = require('../../models/User');
const { requireDb } = require('../../middleware/requireDb');

router.post('/admin-signup', async (req, res) => {
  try {
    const { name, email, phone, password, secret } = req.body;
    // Optional: Check secret/invite code
    if (!secret || secret !== process.env.ADMIN_SIGNUP_SECRET) {
      return res.status(403).json({ message: 'Invalid admin secret.' });
    }
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({ message: 'Name, password, and email or phone are required' });
    }
    const normalizedEmail = email ? String(email).trim().toLowerCase() : '';
    const normalizedPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const orQuery = [];
    if (normalizedEmail) orQuery.push({ email: normalizedEmail });
    if (normalizedPhone) orQuery.push({ phone: normalizedPhone });
    const existing = orQuery.length ? await User.findOne({ $or: orQuery }) : null;
    if (existing) {
      return res.status(409).json({ message: 'User already exists with this email or phone' });
    }
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email: normalizedEmail || undefined,
      phone: normalizedPhone || undefined,
      role: 'admin',
      passwordHash,
    });
    // Issue JWT
    const token = jwt.sign({ id: newUser._id, role: 'admin', name: newUser.name, email: newUser.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(201).json({
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        twoFactorEnabled: newUser.twoFactorEnabled,
      },
      token,
      message: 'Admin created successfully',
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create admin', error: err.message });
  }
});

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

