const express = require('express');
const router = express.Router();
const ServiceBooking = require('../models/ServiceBooking');
const Service = require('../models/Service');
const { requireDb } = require('../middleware/requireDb');
const { requireAuth } = require('../middleware/auth');

// Apply middleware to all routes - all require authentication
router.use(requireDb, requireAuth);

// PATCH /api/service-bookings/:id/payment-status - Update payment status/method for a service booking
router.patch('/:id/payment-status', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { paymentStatus, paymentMethod } = req.body;
        const allowedStatuses = ['pending', 'paid', 'failed'];
        const allowedMethods = ['cash', 'online', ''];

        if (!paymentStatus || !allowedStatuses.includes(paymentStatus)) {
            return res.status(400).json({ message: 'Invalid payment status' });
        }
        if (paymentMethod && !allowedMethods.includes(paymentMethod)) {
            return res.status(400).json({ message: 'Invalid payment method' });
        }

        const booking = await ServiceBooking.findById(id);
        if (!booking) {
            return res.status(404).json({ message: 'Service booking not found' });
        }
        // Only the user who booked or admin can update payment
        if (booking.userId !== req.user?.id && req.user?.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }
        booking.paymentStatus = paymentStatus;
        if (paymentMethod) booking.paymentMethod = paymentMethod;
        await booking.save();
        res.json(booking);
    } catch (err) {
        next(err);
    }
});

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

        // Derive a numeric base price from service.priceRange (strip currency symbols / text)
        let basePrice = 0;
        if (service.priceRange) {
            const numeric = Number(String(service.priceRange).replace(/[^0-9.]/g, ''));
            if (Number.isFinite(numeric) && numeric > 0) {
                basePrice = numeric;
            }
        }

        // Compute total price (per-guest pricing)
        const guestCount = Number(guests);
        const totalPrice = basePrice > 0 && Number.isFinite(guestCount)
            ? basePrice * guestCount
            : 0;

        // Always create booking with 'pending' status - admin approval required before confirmation
        const booking = await ServiceBooking.create({
            serviceId: service._id,
            serviceName: service.name,
            category: service.category,
            priceRange: service.priceRange || '',
            date: new Date(date),
            time,
            guests: guestCount,
            userId: req.user?.id || '',
            guestName,
            guestEmail,
            guestPhone: guestPhone ? String(guestPhone).replace(/^\+/, '') : '',
            specialRequests: specialRequests || '',
            status: 'pending', // Always start as pending - admin must approve before confirmation
            totalPrice,
        });

        // Create in-app notification for admin
        try {
            const Notification = require('../models/Notification');
            await Notification.create({
                title: 'New Service Booking',
                message: `${guestName} (${guestEmail}) booked "${service.name}" for ${new Date(date).toLocaleDateString()}.`,
                role: 'admin',
                userId: '',
            });
        } catch (err) {
            console.warn('Failed to create admin notification:', err);
        }

        // Send email notifications
        try {
            const emailService = require('../utils/emailService');
            // Send to admin - new service booking
            await emailService.sendNewServiceBookingAdminNotification(booking);
        } catch (err) {
            console.warn('Failed to send email notifications:', err);
        }

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

        // Send cancellation email to user
        try {
            const emailService = require('../utils/emailService');
            // Use booking cancellation template (similar structure)
            await emailService.sendEmail({
                to: booking.guestEmail,
                subject: `Service Booking Cancelled - ${booking.serviceName}`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Service Booking Cancelled</h1>
                            </div>
                            <div class="content">
                                <p>Dear ${booking.guestName},</p>
                                <p>Your service booking for <strong>${booking.serviceName}</strong> has been cancelled as requested.</p>
                                <p>If you made a payment, the refund will be processed according to our cancellation policy.</p>
                                <p>We hope to serve you in the future!</p>
                                <div class="footer">
                                    <p>Best regards,<br>Hotel Management Team</p>
                                </div>
                            </div>
                        </div>
                    </body>
                    </html>
                `,
            });
        } catch (err) {
            console.warn('Failed to send cancellation email:', err);
        }

        res.json({ message: 'Booking cancelled successfully', booking });
    } catch (err) {
        console.error('Error cancelling service booking:', err);
        next(err);
    }
});

module.exports = router;