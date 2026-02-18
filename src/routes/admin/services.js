const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Service = require('../../models/Service');
const { requireDb } = require('../../middleware/requireDb');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

router.use(requireDb);

// Setup multer for service image uploads
const serviceImagesDir = path.join(__dirname, '..', '..', '..', 'uploads', 'services');
fs.mkdirSync(serviceImagesDir, { recursive: true });

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

// Setup multer for service video uploads
const serviceVideosDir = path.join(__dirname, '..', '..', '..', 'uploads', 'services', 'videos');
fs.mkdirSync(serviceVideosDir, { recursive: true });

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
    const allowed = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only MP4, WebM, OGG, and MOV videos are allowed.'));
    }
    cb(null, true);
  },
});

// GET /api/services
router.get('/', async (req, res, next) => {
  try {
    const services = await Service.find().lean();
    res.json(services);
  } catch (err) {
    next(err);
  }
});

// POST /api/services
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, category, description, image, video, priceRange, availableTimes } = req.body || {};
    if (!name || !category) {
      return res.status(400).json({ message: 'Name and category are required' });
    }

    const created = await Service.create({
      name,
      category,
      description: description || '',
      image: image || '',
      video: video || '',
      priceRange: priceRange || '',
      availableTimes: Array.isArray(availableTimes) ? availableTimes : [],
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// POST /api/services/:id/upload-image
router.post('/:id/upload-image', requireAuth, requireAdmin, uploadServiceImage.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    service.image = `/uploads/services/${req.file.filename}`;
    await service.save();

    res.json({
      message: 'Image uploaded successfully',
      image: service.image,
      service,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/services/:id/upload-video
router.post('/:id/upload-video', requireAuth, requireAdmin, uploadServiceVideo.single('video'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video uploaded' });
    }

    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    service.video = `/uploads/services/videos/${req.file.filename}`;
    await service.save();

    res.json({
      message: 'Video uploaded successfully',
      video: service.video,
      service,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/services/:id
router.get('/:id', async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id).lean();
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    res.json(service);
  } catch (err) {
    next(err);
  }
});

// PUT /api/services/:id
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, category, description, image, video, priceRange, availableTimes } = req.body || {};
    if (!name || !category) {
      return res.status(400).json({ message: 'Name and category are required' });
    }

    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      {
        name,
        category,
        description: description || '',
        image: image || '',
        video: video || '',
        priceRange: priceRange || '',
        availableTimes: Array.isArray(availableTimes) ? availableTimes : [],
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/services/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const deleted = await Service.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ message: 'Service not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

