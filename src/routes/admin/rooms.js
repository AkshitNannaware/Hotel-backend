const express = require('express');
const Room = require('../../models/Room');
const { requireDb } = require('../../middleware/requireDb');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireDb);


// Setup folders for uploads
const roomImagesDir = path.join(__dirname, '..', '..', '..', 'uploads', 'rooms');
const roomVideosDir = path.join(__dirname, '..', '..', '..', 'uploads', 'rooms', 'videos');
fs.mkdirSync(roomImagesDir, { recursive: true });
fs.mkdirSync(roomVideosDir, { recursive: true });

// Multer Storage Config for Images
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
const uploadRoomImage = multer({
  storage: roomImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
    cb(null, true);
  },
});

// Multer Storage Config for Videos
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only MP4, WEBM, and OGG videos are allowed.'));
    }
    cb(null, true);
  },
});

// POST /api/admin/rooms/:id/upload-images
router.post('/:id/upload-images', requireAuth, requireAdmin, uploadRoomImage.array('images', 5), async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images uploaded' });
    }
    const imagePaths = req.files.map(f => `/uploads/rooms/${f.filename}`);
    room.images = [...(room.images || []), ...imagePaths];
    await room.save();
    res.json({ message: 'Images uploaded', images: room.images, room });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/rooms/:id/upload-video
router.post('/:id/upload-video', requireAuth, requireAdmin, uploadRoomVideo.single('video'), async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No video uploaded' });
    }
    room.video = `/uploads/rooms/videos/${req.file.filename}`;
    await room.save();
    res.json({ message: 'Video uploaded', video: room.video, room });
  } catch (err) {
    next(err);
  }
});

// GET /api/rooms
router.get('/', async (req, res, next) => {
  try {
    const rooms = await Room.find().lean();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// GET /api/rooms/:id
router.get('/:id', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id).lean();
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    res.json(room);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

