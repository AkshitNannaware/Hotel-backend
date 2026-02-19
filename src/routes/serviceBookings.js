// const express = require('express');
// const router = express.Router();
// const ServiceBooking = require('../models/ServiceBooking');
// const Service = require('../models/Service');
// const { requireDb } = require('../middleware/requireDb');
// const { requireAuth } = require('../middleware/auth');

// router.use(requireDb, requireAuth);

// const ACTIVE_SERVICE_STATUSES = ['pending', 'confirmed'];

// // Helper for date window
// const getDayWindow = (value) => {
//     const base = new Date(value);
//     const start = new Date(base);
//     start.setHours(0, 0, 0, 0);
//     const end = new Date(start);
//     end.setDate(end.getDate() + 1);
//     return { start, end };
// };

// // POST /api/service-bookings
// router.post('/', async (req, res, next) => {
//     try {
//         const { serviceId, date, time, guests, guestName, guestEmail, guestPhone } = req.body;

//         if (!serviceId || !date || !time || !guests || !guestName) {
//             return res.status(400).json({ message: 'Missing required fields' });
//         }

//         const service = await Service.findById(serviceId).lean();
//         if (!service) return res.status(404).json({ message: 'Service not found' });

//         const booking = await ServiceBooking.create({
//             serviceId: service._id,
//             serviceName: service.name,
//             date: new Date(date),
//             time,
//             guests: Number(guests),
//             userId: req.user?.id || '',
//             guestName,
//             guestEmail,
//             guestPhone,
//             status: 'pending'
//         });

//         res.status(201).json(booking);
//     } catch (err) {
//         next(err);
//     }
// });

// module.exports = router;















/**
 * User Service Bookings Routes
 * 
 * These routes are for regular users to:
 * - Create service bookings (always created as 'pending', requires admin approval)
 * - View their own service bookings
 * - Cancel their own pending bookings
 * 
 * Base path: /api/service-bookings
 * All routes require authentication (requireAuth)
 */
const express = require('express');
const router = express.Router();
const ServiceBooking = require('../models/ServiceBooking');
const Service = require('../models/Service');
const { requireDb } = require('../middleware/requireDb');
const { requireAuth } = require('../middleware/auth');

// Apply middleware to all routes - all require authentication
router.use(requireDb, requireAuth);

// POST /api/service-bookings - Create a new booking
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
            specialRequests 
        } = req.body;

        // Reject if status is provided - status can only be set by admin
        if (req.body.status !== undefined) {
            return res.status(400).json({ 
                message: 'Status cannot be set by user. All bookings start as pending and require admin approval.' 
            });
        }

        if (!serviceId || !date || !time || !guests || !guestName || !guestEmail) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const service = await Service.findById(serviceId).lean();
        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        // Always create booking with 'pending' status - admin approval required before confirmation
        const booking = await ServiceBooking.create({
            serviceId: service._id,
            serviceName: service.name,
            category: service.category,
            priceRange: service.priceRange || '',
            date: new Date(date),
            time,
            guests: Number(guests),
            userId: req.user?.id || '',
            guestName,
            guestEmail,
            guestPhone: guestPhone || '',
            specialRequests: specialRequests || '',
            status: 'pending' // Always start as pending - admin must approve before confirmation
        });

        res.status(201).json(booking);
    } catch (err) {
        console.error('Error creating service booking:', err);
        next(err);
    }
});

// GET /api/service-bookings - Get current user's service bookings
router.get('/', async (req, res, next) => {
    try {
        // Users can only view their own bookings
        const bookings = await ServiceBooking.find({ userId: req.user?.id }).sort({ date: -1 });
        res.json(bookings);
    } catch (err) {
        console.error('Error fetching user service bookings:', err);
        next(err);
    }
});

// GET /api/service-bookings/user/:userId - Get user's service bookings (alternative endpoint)
router.get('/user/:userId', async (req, res, next) => {
    try {
        const { userId } = req.params;
        
        // Users can only view their own bookings, admins can view any
        if (req.user?.id !== userId && req.user?.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const bookings = await ServiceBooking.find({ userId }).sort({ date: -1 });
        res.json(bookings);
    } catch (err) {
        console.error('Error fetching user service bookings:', err);
        next(err);
    }
});

// GET /api/service-bookings/:id - Get single booking
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Prevent /:id from matching /user/:userId paths
        if (id === 'user') {
            return res.status(404).json({ message: 'Service booking not found' });
        }
        
        const booking = await ServiceBooking.findById(id);
        
        if (!booking) {
            return res.status(404).json({ message: 'Service booking not found' });
        }

        // Check authorization - user can view their own, admin can view any
        if (booking.userId !== req.user?.id && req.user?.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(booking);
    } catch (err) {
        console.error('Error fetching service booking:', err);
        next(err);
    }
});

// DELETE /api/service-bookings/:id - Cancel booking (user or admin)
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const booking = await ServiceBooking.findById(id);
        
        if (!booking) {
            return res.status(404).json({ message: 'Service booking not found' });
        }

        // Check authorization - user can cancel their own pending bookings, admin can cancel any
        if (req.user?.role !== 'admin') {
            if (booking.userId !== req.user?.id) {
                return res.status(403).json({ message: 'Access denied' });
            }
            if (booking.status !== 'pending') {
                return res.status(400).json({ message: 'Can only cancel pending bookings' });
            }
        }

        // Instead of deleting, update status to cancelled
        booking.status = 'cancelled';
        await booking.save();

        res.json({ message: 'Booking cancelled successfully', booking });
    } catch (err) {
        console.error('Error cancelling service booking:', err);
        next(err);
    }
});

module.exports = router;