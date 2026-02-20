const express = require('express');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get all notifications for user or admin
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    let filter = { $or: [ { role: 'all' }, { role: user.role } ] };
    if (user.role === 'user') {
      filter.$or.push({ userId: user.id });
    }
    const notifications = await Notification.find(filter).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

module.exports = router;
