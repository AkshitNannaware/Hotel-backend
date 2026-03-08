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

// PATCH /api/notifications/:id/read - Mark a notification as read
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    // Only allow if the notification is relevant to the user
    const canAccess =
      notification.role === 'all' ||
      notification.role === user.role ||
      (notification.role === 'user' && notification.userId === user.id);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    notification.read = true;
    await notification.save();
    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    // Only allow if the notification is relevant to the user
    const canAccess =
      notification.role === 'all' ||
      notification.role === user.role ||
      (notification.role === 'user' && notification.userId === user.id);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await Notification.deleteOne({ _id: notification._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
