const express = require('express');
const ServiceBooking = require('../models/ServiceBooking');
const Service = require('../models/Service');
const { requireDb } = require('../middleware/requireDb');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireDb, requireAuth);

const ACTIVE_SERVICE_STATUSES = ['pending', 'confirmed'];

const getDayWindow = (value) => {
  const base = new Date(value);
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const parseTimeToMinutes = (time) => {
  if (!time || typeof time !== 'string') {
    return null;
  }

  const trimmed = time.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) {
    return null;
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();

  if (meridiem) {
    if (meridiem === 'PM' && hours < 12) {
      hours += 12;
    }
    if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
};

const resolveNextServiceSlot = async (serviceId, serviceTimes, requestedDate, requestedTime) => {
  const normalizedTimes = (serviceTimes || [])
    .map((time) => ({ time, minutes: parseTimeToMinutes(time) }))
    .filter((entry) => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);

  const fallbackTimes = normalizedTimes.length ? normalizedTimes : [{ time: requestedTime, minutes: parseTimeToMinutes(requestedTime) ?? 0 }];
  const requestedMinutes = parseTimeToMinutes(requestedTime) ?? 0;

  for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
    const candidateDate = new Date(requestedDate);
    candidateDate.setDate(candidateDate.getDate() + dayOffset);

    const { start, end } = getDayWindow(candidateDate);
    const existing = await ServiceBooking.find({
      serviceId,
      status: { $in: ACTIVE_SERVICE_STATUSES },
      date: { $gte: start, $lt: end },
    })
      .select({ time: 1 })
      .lean();

    const bookedTimes = new Set(existing.map((booking) => booking.time));

    const candidates = dayOffset === 0
      ? fallbackTimes.filter((entry) => entry.minutes >= requestedMinutes)
      : fallbackTimes;

    const available = candidates.find((entry) => !bookedTimes.has(entry.time));
    if (available) {
      return { date: candidateDate, time: available.time };
    }
  }

  return { date: requestedDate, time: requestedTime };
};

// POST /api/service-bookings
router.post('/', async (req, res, next) => {
  try {
    const { serviceId, date, time, guests, specialRequests, guestName, guestEmail, guestPhone } = req.body || {};

    if (!serviceId || !date || !time || !guests || !guestName || !guestEmail || !guestPhone) {
      return res.status(400).json({ message: 'Missing required service booking fields' });
    }

    const service = await Service.findById(serviceId).lean();
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const requestedDate = new Date(date);
    const { start, end } = getDayWindow(requestedDate);
    const overlap = await ServiceBooking.findOne({
      serviceId: service._id.toString(),
      status: { $in: ACTIVE_SERVICE_STATUSES },
      date: { $gte: start, $lt: end },
      time,
    }).lean();

    let scheduledDate = requestedDate;
    let scheduledTime = time;

    if (overlap) {
      const adjusted = await resolveNextServiceSlot(
        service._id.toString(),
        service.availableTimes || [],
        requestedDate,
        time
      );
      scheduledDate = adjusted.date;
      scheduledTime = adjusted.time;
    }

    const booking = await ServiceBooking.create({
      serviceId: service._id.toString(),
      serviceName: service.name,
      category: service.category,
      priceRange: service.priceRange || '',
      date: scheduledDate,
      time: scheduledTime,
      guests: Number(guests) || 1,
      specialRequests: specialRequests || '',
      userId: req.user?.id || '',
      guestName,
      guestEmail,
      guestPhone,
      status: 'confirmed',
      bookingDate: new Date(),
    });

    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

// GET /api/service-bookings
router.get('/', async (req, res, next) => {
  try {
    const bookings = await ServiceBooking.find({ userId: req.user?.id || '' })
      .sort({ createdAt: -1 })
      .lean();
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
