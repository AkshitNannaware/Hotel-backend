const express = require('express');
const Room = require('../../models/Room');
const { requireDb } = require('../../middleware/requireDb');

const router = express.Router();

router.use(requireDb);

// GET /api/rooms
router.get('/', async (req, res, next) => {
  try {
    const rooms = await Room.find().lean();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// GET /api/rooms/:id
router.get('/:id', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id).lean();
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    res.json(room);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

