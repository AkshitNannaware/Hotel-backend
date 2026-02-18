const express = require('express');
const router = express.Router();
const Contact = require('../../models/Contact');

// GET /api/admin/contacts - Get all contact submissions
router.get('/', async (req, res) => {
  try {
    const { status, limit } = req.query;
    
    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(limit ? parseInt(limit) : 100);

    // Get statistics
    const stats = {
      total: await Contact.countDocuments(),
      new: await Contact.countDocuments({ status: 'new' }),
      read: await Contact.countDocuments({ status: 'read' }),
      replied: await Contact.countDocuments({ status: 'replied' }),
      archived: await Contact.countDocuments({ status: 'archived' })
    };

    res.json({
      contacts,
      stats
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ 
      error: 'Failed to fetch contacts' 
    });
  }
});

// GET /api/admin/contacts/:id - Get a single contact
router.get('/:id', async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Mark as read if it's new
    if (contact.status === 'new') {
      contact.status = 'read';
      await contact.save();
    }

    res.json(contact);
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ 
      error: 'Failed to fetch contact' 
    });
  }
});

// PATCH /api/admin/contacts/:id - Update contact status
router.patch('/:id', async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    
    const updateData = {};
    if (status) {
      if (!['new', 'read', 'replied', 'archived'].includes(status)) {
        return res.status(400).json({ 
          error: 'Invalid status. Must be: new, read, replied, or archived' 
        });
      }
      updateData.status = status;
    }
    if (adminNotes !== undefined) {
      updateData.adminNotes = adminNotes;
    }
    updateData.updatedAt = new Date();

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({
      message: 'Contact updated successfully',
      contact
    });
  } catch (error) {
    console.error('Error updating contact:', error);
    res.status(500).json({ 
      error: 'Failed to update contact' 
    });
  }
});

// DELETE /api/admin/contacts/:id - Delete a contact
router.delete('/:id', async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ 
      message: 'Contact deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ 
      error: 'Failed to delete contact' 
    });
  }
});

module.exports = router;
