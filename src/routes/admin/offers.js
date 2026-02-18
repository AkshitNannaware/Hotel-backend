const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Offer = require('../../models/Offer');
const { requireDb } = require('../../middleware/requireDb');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

router.use(requireDb, requireAuth, requireAdmin);

const offerImagesDir = path.join(__dirname, '..', '..', '..', 'uploads', 'offers');
fs.mkdirSync(offerImagesDir, { recursive: true });

const offerImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, offerImagesDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext.toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `offer-${unique}${safeExt}`);
  },
});

const uploadOfferImage = multer({
  storage: offerImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
    cb(null, true);
  },
});

const normalizeOfferPayload = (payload = {}) => {
  const safePayload = payload || {};
  const toNumber = (value, fallback = 0) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    title: String(safePayload.title || '').trim(),
    subtitle: String(safePayload.subtitle || '').trim(),
    description: String(safePayload.description || '').trim(),
    price: toNumber(safePayload.price, 0),
    rating: toNumber(safePayload.rating, 4.9),
    reviewCount: toNumber(safePayload.reviewCount, 0),
    badgeText: String(safePayload.badgeText || '').trim(),
    expiryDate: safePayload.expiryDate ? new Date(safePayload.expiryDate) : null,
    ctaText: String(safePayload.ctaText || '').trim(),
    image: String(safePayload.image || '').trim(),
    active: safePayload.active !== undefined ? Boolean(safePayload.active) : true,
  };
};

// GET /api/admin/offers
router.get('/', async (req, res, next) => {
  try {
    const offers = await Offer.find().sort({ createdAt: -1 }).lean();
    res.json(offers);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/offers
router.post('/', async (req, res, next) => {
  try {
    const payload = normalizeOfferPayload(req.body || {});
    if (!payload.title) {
      return res.status(400).json({ message: 'Title is required' });
    }
    const created = await Offer.create(payload);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/offers/:id
router.put('/:id', async (req, res, next) => {
  try {
    const payload = normalizeOfferPayload(req.body || {});
    if (!payload.title) {
      return res.status(400).json({ message: 'Title is required' });
    }
    const updated = await Offer.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true }).lean();
    if (!updated) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/offers/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await Offer.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/offers/:id/upload-image
router.post('/:id/upload-image', uploadOfferImage.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    offer.image = `/uploads/offers/${req.file.filename}`;
    await offer.save();

    res.json({
      message: 'Image uploaded successfully',
      image: offer.image,
      offer,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
