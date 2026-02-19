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



module.exports = router;