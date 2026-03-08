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
        const { status, paymentStatus } = req.body;
        const allowedStatuses = ['pending', 'confirmed', 'cancelled'];
        const allowedPaymentStatuses = ['pending', 'paid', 'failed'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status value' });
        }
        if (paymentStatus && !allowedPaymentStatuses.includes(paymentStatus)) {
            return res.status(400).json({ message: 'Invalid payment status value' });
        }

        const booking = await ServiceBooking.findById(id);
        if (!booking) {
            return res.status(404).json({ message: 'Service booking not found' });
        }

        const previousStatus = booking.status;
        booking.status = status;
        if (paymentStatus) booking.paymentStatus = paymentStatus;
        await booking.save();

        // Create in-app notifications for user based on status change
        try {
            const Notification = require('../../models/Notification');
            if (status === 'confirmed' && previousStatus !== 'confirmed') {
                await Notification.create({
                    userId: booking.userId,
                    title: 'Service Booking Confirmed',
                    message: `Your booking for "${booking.serviceName}" on ${new Date(booking.date).toLocaleDateString()} has been confirmed.`,
                    role: 'user',
                });
            } else if (status === 'cancelled' && previousStatus !== 'cancelled') {
                await Notification.create({
                    userId: booking.userId,
                    title: 'Service Booking Cancelled',
                    message: `Your booking for "${booking.serviceName}" has been cancelled. Please contact us if you have questions.`,
                    role: 'user',
                });
            }
            // In-app notification for payment received
            if (paymentStatus === 'paid' && previousStatus !== 'paid') {
                await Notification.create({
                    userId: booking.userId,
                    title: 'Service Payment Received',
                    message: `Your payment of $${booking.totalPrice} for "${booking.serviceName}" has been received. Thank you!`,
                    role: 'user',
                });
            }
        } catch (err) {
            console.warn('Failed to create in-app notification:', err);
        }

        // Send email notifications based on status change
        try {
            const emailService = require('../../utils/emailService');
            if (status === 'confirmed' && previousStatus !== 'confirmed') {
                await emailService.sendServiceBookingConfirmation(booking);
            }
            // Send payment notification if payment status changed to paid
            if (paymentStatus === 'paid' && booking.paymentStatus === 'paid') {
                await emailService.sendServicePaymentConfirmation(booking);
                await emailService.sendPaymentReceivedAdminNotification(booking, true);
            }
        } catch (err) {
            console.warn('Failed to send email notification:', err);
        }

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
            guestPhone: guestPhone ? String(guestPhone).replace(/^\+/, '') : '',
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

        // Debug: Log first booking to see what we received
        console.log('Bulk import received:', bookings.length, 'bookings');
        if (bookings.length > 0) {
            console.log('Sample booking (first):', JSON.stringify(bookings[0], null, 2));
            console.log('Sample booking (second):', bookings.length > 1 ? JSON.stringify(bookings[1], null, 2) : 'N/A');
        }

        const allowedStatuses = new Set(['pending', 'confirmed', 'cancelled']);
        const allowedCategories = new Set(['dining', 'restaurant', 'spa', 'bar']);

        const toCreate = [];
        const errors = [];
        
        for (let i = 0; i < bookings.length; i++) {
            const row = bookings[i];
            const rawServiceId = String(row?.serviceId || '').trim();
            const rawServiceName = String(row?.serviceName || '').trim();
            const date = row?.date;
            const time = String(row?.time || '').trim();
            const guests = row?.guests;
            const guestName = String(row?.guestName || '').trim();
            const guestEmail = String(row?.guestEmail || '').trim();
            const guestPhone = String(row?.guestPhone || '').trim() || 'N/A';

            // Debug first row
            if (i === 0) {
                console.log('Processing row 1:', {
                    rawServiceId,
                    rawServiceName,
                    date,
                    time,
                    guests,
                    guestName,
                    guestEmail,
                    guestPhone,
                    rowKeys: Object.keys(row || {})
                });
            }

            // Check for missing required fields with detailed error
            const missingFields = [];
            if (!rawServiceId && !rawServiceName) missingFields.push('Service ID or Service Name');
            if (!date) missingFields.push('Date');
            if (!time) missingFields.push('Time');
            if (!guests) missingFields.push('Guests');
            if (!guestName) missingFields.push('Guest Name');
            if (!guestEmail) missingFields.push('Guest Email');

            if (missingFields.length > 0) {
                errors.push(`Row ${i + 1}: Missing required fields: ${missingFields.join(', ')}`);
                if (i === 0) {
                    console.log('Row 1 validation failed. Row data:', row);
                }
                continue;
            }

            // Try to resolve service either by ID or by name
            let service = null;
            if (rawServiceId) {
                try {
                    service = await Service.findById(rawServiceId).lean();
                } catch (err) {
                    // Invalid ID format, try name lookup
                }
            }
            if (!service && rawServiceName) {
                // Try exact match first (case-insensitive)
                service = await Service.findOne({
                    name: { $regex: new RegExp(`^${rawServiceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                }).lean();
                
                // If exact match fails, try partial match
                if (!service) {
                    service = await Service.findOne({
                        name: { $regex: new RegExp(rawServiceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
                    }).lean();
                }
            }

            if (!service) {
                // Debug: List available services for first error
                if (i === 0 || errors.length === 0) {
                    const allServices = await Service.find({}, 'name _id category').lean();
                    console.log('Available services in database:', allServices.map(s => ({ 
                        id: String(s._id), 
                        name: s.name,
                        category: s.category
                    })));
                    console.log('Trying to match:', { rawServiceId, rawServiceName });
                }
                errors.push(`Row ${i + 1}: Service not found. Tried ID: "${rawServiceId || 'N/A'}", Name: "${rawServiceName || 'N/A'}"`);
                continue;
            }
            
            // Debug: Log successful service match
            if (i === 0) {
                console.log('Row 1 service matched:', { 
                    serviceId: String(service._id), 
                    serviceName: service.name,
                    category: service.category
                });
            }

            const statusRaw = String(row?.status || '').toLowerCase().trim();
            const status = allowedStatuses.has(statusRaw) ? statusRaw : 'pending';

            // Validate and set category
            let category = String(row?.category || service.category || '').toLowerCase().trim();
            if (!allowedCategories.has(category)) {
                category = service.category; // Fallback to service category
            }

            // Validate date
            let bookingDate;
            try {
                bookingDate = new Date(date);
                if (isNaN(bookingDate.getTime())) {
                    if (i === 0) {
                        console.log('Row 1 date validation failed. Date value:', date, 'Type:', typeof date);
                    }
                    errors.push(`Row ${i + 1}: Invalid date format: "${date}"`);
                    continue;
                }
            } catch (err) {
                if (i === 0) {
                    console.log('Row 1 date parsing error:', err.message, 'Date value:', date);
                }
                errors.push(`Row ${i + 1}: Invalid date: "${date}"`);
                continue;
            }
            
            // Debug: Log successful date parsing
            if (i === 0) {
                console.log('Row 1 date parsed successfully:', { 
                    original: date, 
                    parsed: bookingDate.toISOString() 
                });
            }

            // Calculate totalPrice from priceRange if available
            let totalPrice = 0;
            if (service.priceRange) {
                const numeric = Number(String(service.priceRange).replace(/[^0-9.]/g, ''));
                if (Number.isFinite(numeric) && numeric > 0) {
                    totalPrice = numeric * (Number(guests) || 1);
                }
            }

            toCreate.push({
                serviceId: String(service._id),
                serviceName: service.name,
                category: category,
                priceRange: service.priceRange || '',
                totalPrice: totalPrice,
                date: bookingDate,
                time: String(time),
                guests: Number(guests) || 1,
                userId: String(row?.userId || ''),
                guestName: String(guestName),
                guestEmail: String(guestEmail),
                guestPhone: guestPhone,
                specialRequests: String(row?.specialRequests || ''),
                status,
                paymentStatus: 'pending',
            });
        }

        if (toCreate.length === 0) {
            console.log('No valid bookings created. Total errors:', errors.length);
            console.log('All errors:', errors);
            return res.status(400).json({ 
                message: `No valid bookings to import. ${errors.length > 0 ? `Found ${errors.length} error(s).` : 'All rows were invalid.'}`,
                errors: errors.slice(0, 20), // Return first 20 errors
                totalRows: bookings.length,
                validRows: 0,
                sampleInput: bookings.length > 0 ? bookings[0] : null
            });
        }
        
        console.log('Successfully prepared', toCreate.length, 'bookings to create');

        const created = await ServiceBooking.insertMany(toCreate, { ordered: false });
        res.json({ 
            success: true, 
            count: created.length,
            totalRows: bookings.length,
            validRows: created.length,
            invalidRows: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
        });
    } catch (err) {
        // Handle validation errors from mongoose
        if (err.name === 'ValidationError') {
            const validationErrors = Object.values(err.errors || {}).map((e) => e.message);
            return res.status(400).json({ 
                message: 'Validation error',
                errors: validationErrors
            });
        }
        next(err);
    }
});

module.exports = router;