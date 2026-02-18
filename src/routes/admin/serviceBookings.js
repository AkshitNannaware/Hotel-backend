const express = require('express');
const ServiceBooking = require('../../models/ServiceBooking');
const Service = require('../../models/Service');
const { requireDb } = require('../../middleware/requireDb');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

router.use(requireDb, requireAuth, requireAdmin);

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

  const fallbackTimes = normalizedTimes.length
    ? normalizedTimes
    : [{ time: requestedTime, minutes: parseTimeToMinutes(requestedTime) ?? 0 }];
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

const resolveService = async (serviceId, serviceName) => {
  if (serviceId) {
    const service = await Service.findById(serviceId).lean();
    if (service) {
      return service;
    }
  }

  if (serviceName) {
    const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const service = await Service.findOne({ name: new RegExp(`^${escaped}$`, 'i') }).lean();
    if (service) {
      return service;
    }
  }

  return null;
};

// POST /api/admin/service-bookings
router.post('/', async (req, res, next) => {
  try {
    const {
      serviceId,
      serviceName,
      date,
      time,
      guests,
      specialRequests,
      guestName,
      guestEmail,
      guestPhone,
      status,
    } = req.body || {};

    if (!date || !time || !guests || !guestName || !guestEmail || !guestPhone) {
      return res.status(400).json({ message: 'Missing required service booking fields' });
    }

    const service = await resolveService(serviceId, serviceName);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const requestedDate = new Date(date);
    if (Number.isNaN(requestedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid service booking date' });
    }

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

    const allowedStatuses = ['pending', 'confirmed', 'cancelled'];
    const nextStatus = allowedStatuses.includes(status) ? status : 'confirmed';

    const booking = await ServiceBooking.create({
      serviceId: service._id.toString(),
      serviceName: service.name,
      category: service.category,
      priceRange: service.priceRange || '',
      date: scheduledDate,
      time: scheduledTime,
      guests: Number(guests) || 1,
      specialRequests: specialRequests || '',
      userId: '',
      guestName,
      guestEmail,
      guestPhone,
      status: nextStatus,
      bookingDate: new Date(),
    });

    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/service-bookings
router.get('/', async (req, res, next) => {
  try {
    const bookings = await ServiceBooking.find().sort({ createdAt: -1 }).lean();
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/service-bookings/bulk-import
router.post('/bulk-import', async (req, res, next) => {
  try {
    const { bookings } = req.body || {};

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return res.status(400).json({ message: 'Bookings array is required and cannot be empty' });
    }

    const created = [];

    for (let i = 0; i < bookings.length; i += 1) {
      const booking = bookings[i];
      const {
        serviceId,
        serviceName,
        date,
        time,
        guests,
        specialRequests,
        guestName,
        guestEmail,
        guestPhone,
        status,
      } = booking || {};

      if (!date || !time || !guests || !guestName || !guestEmail || !guestPhone) {
        return res.status(400).json({ message: `Missing required fields at row ${i + 1}` });
      }

      const service = await resolveService(serviceId, serviceName);
      if (!service) {
        return res.status(404).json({ message: `Service not found at row ${i + 1}` });
      }

      const requestedDate = new Date(date);
      if (Number.isNaN(requestedDate.getTime())) {
        return res.status(400).json({ message: `Invalid date at row ${i + 1}` });
      }

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

      const allowedStatuses = ['pending', 'confirmed', 'cancelled'];
      const nextStatus = allowedStatuses.includes(status) ? status : 'confirmed';

      const createdBooking = await ServiceBooking.create({
        serviceId: service._id.toString(),
        serviceName: service.name,
        category: service.category,
        priceRange: service.priceRange || '',
        date: scheduledDate,
        time: scheduledTime,
        guests: Number(guests) || 1,
        specialRequests: specialRequests || '',
        userId: '',
        guestName,
        guestEmail,
        guestPhone,
        status: nextStatus,
        bookingDate: new Date(),
      });

      created.push(createdBooking);
    }

    res.json({
      success: true,
      count: created.length,
      message: `Successfully imported ${created.length} service bookings`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
