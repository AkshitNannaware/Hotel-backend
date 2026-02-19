/**
 * Admin Service Bookings Routes
 * 
 * These routes are for administrators to:
 * - View all service bookings across all users
 * - Create service bookings on behalf of users
 * - Update booking status (approve/reject/cancel)
 * - Bulk import service bookings from Excel
 * 
 * Base path: /api/admin/service-bookings
 * All routes require admin authentication (requireAuth + requireAdmin)
 */
const express = require('express');
const router = express.Router();
const ServiceBooking = require('../../models/ServiceBooking'); 
const Service = require('../../models/Service');
const { requireDb } = require('../../middleware/requireDb');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

// Apply middleware to all routes - all require admin access
router.use(requireDb, requireAuth, requireAdmin);

// Helpers
const getDayWindow = (value) => {
    const base = new Date(value);
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
};

// PATCH /api/admin/service-bookings/:id/status
router.patch('/:id/status', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const allowedStatuses = ['pending', 'confirmed', 'cancelled'];
        
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status value' });
        }
        
        const booking = await ServiceBooking.findById(id);
        if (!booking) {
            return res.status(404).json({ message: 'Service booking not found' });
        }
        
        booking.status = status;
        await booking.save();
        
        // Return the full booking object for consistency
        const updatedBooking = await ServiceBooking.findById(id).lean();
        res.json(updatedBooking);
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

// POST /api/admin/service-bookings - Create a new service booking (admin)
router.post('/', async (req, res, next) => {
    try {
        const {
            serviceId,
            date,
            time,
            guests,
            guestName,
            guestEmail,
            guestPhone,
            specialRequests,
        } = req.body || {};

        if (!serviceId || !date || !time || !guests || !guestName || !guestEmail) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const service = await Service.findById(serviceId).lean();
        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        const booking = await ServiceBooking.create({
            serviceId: service._id,
            serviceName: service.name,
            category: service.category,
            priceRange: service.priceRange || '',
            date: new Date(date),
            time,
            guests: Number(guests),
            userId: '',
            guestName,
            guestEmail,
            guestPhone: guestPhone || '',
            specialRequests: specialRequests || '',
            status: 'pending',
        });

        res.status(201).json(booking);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/service-bookings/bulk-import - Bulk create service bookings (admin)
router.post('/bulk-import', async (req, res, next) => {
    try {
        const bookings = Array.isArray(req.body?.bookings) ? req.body.bookings : null;
        if (!bookings || bookings.length === 0) {
            return res.status(400).json({ message: 'No bookings provided' });
        }

        const allowedStatuses = new Set(['pending', 'confirmed', 'cancelled']);

        const toCreate = [];
        for (const row of bookings) {
            const serviceId = row?.serviceId;
            const date = row?.date;
            const time = row?.time;
            const guests = row?.guests;
            const guestName = row?.guestName;
            const guestEmail = row?.guestEmail;

            if (!serviceId || !date || !time || !guests || !guestName || !guestEmail) {
                continue;
            }

            const service = await Service.findById(serviceId).lean();
            if (!service) {
                continue;
            }

            const statusRaw = String(row?.status || '').toLowerCase().trim();
            const status = allowedStatuses.has(statusRaw) ? statusRaw : 'pending';

            toCreate.push({
                serviceId: service._id,
                serviceName: service.name,
                category: row?.category || service.category,
                priceRange: service.priceRange || '',
                date: new Date(date),
                time: String(time),
                guests: Number(guests) || 1,
                userId: row?.userId || '',
                guestName: String(guestName),
                guestEmail: String(guestEmail),
                guestPhone: String(row?.guestPhone || ''),
                specialRequests: String(row?.specialRequests || ''),
                status,
            });
        }

        if (toCreate.length === 0) {
            return res.status(400).json({ message: 'No valid bookings to import' });
        }

        const created = await ServiceBooking.insertMany(toCreate, { ordered: false });
        res.json({ success: true, count: created.length });
    } catch (err) {
        next(err);
    }
});

module.exports = router;