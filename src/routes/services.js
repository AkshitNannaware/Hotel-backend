const express = require('express');
const Service = require('../models/Service');
const { requireDb } = require('../middleware/requireDb');

const router = express.Router();

// Public: Get all services
router.get('/', requireDb, async (req, res, next) => {
  try {
    const services = await Service.find().lean();
    res.json(services);
  } catch (err) {
    next(err);
  }
});

// Public: Get a single service by ID
router.get('/:id', requireDb, async (req, res, next) => {
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

module.exports = router;
