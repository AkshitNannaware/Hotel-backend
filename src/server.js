const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
dotenv.config();
mongoose.set('bufferCommands', false);

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/admin/rooms');
const serviceRoutes = require('./routes/admin/services');
const offerRoutes = require('./routes/offers');
const adminOfferRoutes = require('./routes/admin/offers');
const bookingRoutes = require('./routes/bookings');
const adminBookingRoutes = require('./routes/admin/bookings');
const serviceBookingRoutes = require('./routes/serviceBookings');
const contactRoutes = require('./routes/contact');
const adminRoutes = require('./routes/admin/admin');
const adminContactRoutes = require('./routes/admin/contacts');
const adminServiceBookingRoutes = require('./routes/admin/serviceBookings');
const paymentRoutes = require('./routes/payments');
const newsletterRoutes = require('./routes/newsletter');
const adminNewsletterRoutes = require('./routes/admin/newsletters');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });
  next();
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Hotel backend running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin/bookings', adminBookingRoutes);
app.use('/api/service-bookings', serviceBookingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/offers', adminOfferRoutes);
app.use('/api/admin/contacts', adminContactRoutes);
app.use('/api/admin/service-bookings', adminServiceBookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/admin/newsletters', adminNewsletterRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
  });
});

async function startServer() {
  if (!MONGO_URI) {
    console.error('MONGO_URI is not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');
    await ensureAdminUser();
  } catch (err) {
    console.error('MongoDB connection failed.', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Hotel backend listening on port ${PORT}`);
  });
}

async function ensureAdminUser() {
  const adminEmail = 'admin@hotel.com';
  const existing = await User.findOne({ email: adminEmail });
  if (!existing) {
    const passwordHash = await bcrypt.hash('admin', 10);
    await User.create({
      name: 'Admin User',
      email: adminEmail,
      phone: '+1234567890',
      role: 'admin',
      passwordHash,
    });
  }
}


startServer().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
