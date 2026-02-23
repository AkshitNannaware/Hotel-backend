const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Service = require('../../models/Service');
const { requireDb } = require('../../middleware/requireDb');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

router.use(requireDb);

// 1. Setup folders for uploads
const serviceImagesDir = path.join(__dirname, '..', '..', '..', 'uploads', 'services');
const serviceVideosDir = path.join(__dirname, '..', '..', '..', 'uploads', 'services', 'videos');

fs.mkdirSync(serviceImagesDir, { recursive: true });
fs.mkdirSync(serviceVideosDir, { recursive: true });

// 2. Multer Storage Configuration
const serviceImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, serviceImagesDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext.toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `service-${unique}${safeExt}`);
  },
});

const uploadServiceImage = multer({
  storage: serviceImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
    cb(null, true);
  },
});

// Multer Storage for Service Videos
const serviceVideoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, serviceVideosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext.toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `service-video-${unique}${safeExt}`);
  },
});

const uploadServiceVideo = multer({
  storage: serviceVideoStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only MP4, WEBM, and OGG videos are allowed.'));
    }
    cb(null, true);
  },
});




// POST /api/admin/services/:id/upload-image
router.post('/:id/upload-image', requireAuth, requireAdmin, uploadServiceImage.single('image'), async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }
    service.image = `/uploads/services/${req.file.filename}`;
    await service.save();
    res.json({ message: 'Image uploaded', image: service.image, service });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/services/:id/upload-video
router.post('/:id/upload-video', requireAuth, requireAdmin, uploadServiceVideo.single('video'), async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No video uploaded' });
    }
    service.video = `/uploads/services/videos/${req.file.filename}`;
    await service.save();
    res.json({ message: 'Video uploaded', video: service.video, service });
  } catch (err) {
    next(err);
  }
});

module.exports = router;