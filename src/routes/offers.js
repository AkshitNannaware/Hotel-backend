const express = require('express');
const Offer = require('../models/Offer');
const { requireDb } = require('../middleware/requireDb');

const router = express.Router();

router.use(requireDb);

// GET /api/offers
router.get('/', async (req, res, next) => {
  try {
    const offers = await Offer.find({ active: true }).sort({ createdAt: -1 }).lean();
    res.json(offers);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
