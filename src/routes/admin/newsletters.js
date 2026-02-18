const express = require('express');
const router = express.Router();
const Newsletter = require('../../models/Newsletter');
const requireAdmin = require('../../middleware/requireAdmin');

router.use(requireAdmin);

// Get all newsletter subscriptions (admin only)
router.get('/', async (req, res) => {
  try {
    const subscriptions = await Newsletter.find().sort({ subscribedAt: -1 });
    res.json(subscriptions);
  } catch (error) {
    console.error('Error fetching newsletter subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch newsletter subscriptions' });
  }
});

// Delete a newsletter subscription (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Newsletter.findByIdAndDelete(id);
    res.json({ message: 'Subscription deleted successfully' });
  } catch (error) {
    console.error('Error deleting newsletter subscription:', error);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

// Export subscriptions as CSV (admin only)
router.get('/export', async (req, res) => {
  try {
    const subscriptions = await Newsletter.find({ active: true });
    const emails = subscriptions.map(sub => sub.email).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=newsletter-subscriptions.csv');
    res.send('Email,Subscribed At,Status\n' + subscriptions.map(sub => 
      `${sub.email},${sub.subscribedAt.toISOString()},${sub.active ? 'Active' : 'Inactive'}`
    ).join('\n'));
  } catch (error) {
    console.error('Error exporting newsletter subscriptions:', error);
    res.status(500).json({ error: 'Failed to export subscriptions' });
  }
});

module.exports = router;
