const express = require('express');
const router = express.Router();
const User = require('../models/User');

// GET /api/branding - Public branding info (logo, etc.)
router.get('/', async (req, res) => {
  try {
    // Find the first admin user (or however you store branding)
    const admin = await User.findOne({ role: 'admin' }, 'logoUrl address phone email');
    res.json({
      logoUrl: admin?.logoUrl || '',
      address: admin?.address || '',
      phone: admin?.phone || '',
      email: admin?.email || ''
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch branding info' });
  }
});

module.exports = router;
