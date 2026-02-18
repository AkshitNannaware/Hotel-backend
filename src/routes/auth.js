const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';
const OTP_LENGTH = Math.max(4, Number(process.env.OTP_LENGTH || 4));
const OTP_EXPIRES_MINUTES = Math.max(1, Number(process.env.OTP_EXPIRES_MINUTES || 2));
const IS_PROD = process.env.NODE_ENV === 'production';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const normalizePhone = (value) => {
  if (!value) {
    return '';
  }
  const digits = String(value).replace(/\D/g, '');
  return digits ? `+${digits}` : '';
};

const normalizeEmail = (value) => {
  if (!value) {
    return '';
  }
  return String(value).trim().toLowerCase();
};

const buildOtp = (length) => {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
};

const determineChannel = (identifier) => {
  const value = String(identifier || '').trim();
  if (value.includes('@')) {
    return 'email';
  }
  return 'sms';
};

const sendEmailOtp = async (email, otp) => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    if (IS_PROD) {
      throw new Error('Email provider not configured');
    }
    console.log(`[DEV] OTP for ${email}: ${otp}`);
    return;
  }

  await sgMail.send({
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: 'Your Password Reset OTP',
    text: `Your OTP is ${otp}. It expires in ${OTP_EXPIRES_MINUTES} minutes.`,
  });
};

const sendSmsOtp = async (phone, otp) => {
  if (!twilioClient || !process.env.TWILIO_FROM_NUMBER) {
    if (IS_PROD) {
      throw new Error('SMS provider not configured');
    }
    console.log(`[DEV] OTP for ${phone}: ${otp}`);
    return;
  }

  await twilioClient.messages.create({
    to: phone,
    from: process.env.TWILIO_FROM_NUMBER,
    body: `Your OTP is ${otp}. It expires in ${OTP_EXPIRES_MINUTES} minutes.`,
  });
};

function createToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

router.post('/signup', async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }
    const { name, email, phone, password } = req.body;
    const normalizedEmail = email ? String(email).trim().toLowerCase() : '';
    const normalizedPhone = normalizePhone(phone);

    if (!name || !password || (!normalizedEmail && !normalizedPhone)) {
      return res.status(400).json({ message: 'Name, password, and email or phone are required' });
    }

    const orQuery = [];
    if (normalizedEmail) {
      orQuery.push({ email: normalizedEmail });
    }
    if (normalizedPhone) {
      orQuery.push({ phone: normalizedPhone });
    }

    const existing = orQuery.length
      ? await User.findOne({ $or: orQuery })
      : null;

    if (existing) {
      return res
        .status(409)
        .json({ message: 'User already exists with this email or phone' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email: normalizedEmail || undefined,
      phone: normalizedPhone || undefined,
      role: 'user',
      passwordHash,
    });

    const token = createToken(newUser);

    res.status(201).json({
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        twoFactorEnabled: newUser.twoFactorEnabled,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const normalizedIdentifier = String(identifier || '').trim();
    const normalizedPhone = normalizePhone(normalizedIdentifier);

    if (!normalizedIdentifier || !password) {
      return res
        .status(400)
        .json({ message: 'Identifier and password are required' });
    }

    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }

    const phoneCandidates = normalizedPhone
      ? [normalizedPhone, normalizedIdentifier]
      : [normalizedIdentifier];

    const user = await User.findOne({
      $or: [
        { email: normalizedIdentifier.toLowerCase() },
        { phone: { $in: phoneCandidates } },
      ],
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = createToken(user);

    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password/request-otp', async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }

    const { identifier } = req.body;
    const channel = determineChannel(identifier);
    const normalizedIdentifier = channel === 'email'
      ? normalizeEmail(identifier)
      : normalizePhone(identifier);

    if (!normalizedIdentifier) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }

    const orQuery = [];
    if (channel === 'email') {
      orQuery.push({ email: normalizedIdentifier });
    }
    if (channel === 'sms') {
      orQuery.push({ phone: normalizedIdentifier });
    }

    const user = await User.findOne({ $or: orQuery });

    if (!user) {
      return res.status(404).json({ message: 'No account found for this email or phone' });
    }

    const otp = buildOtp(OTP_LENGTH);
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    await PasswordResetOtp.deleteMany({ userId: user._id, identifier: normalizedIdentifier, channel });
    const record = await PasswordResetOtp.create({
      userId: user._id,
      identifier: normalizedIdentifier,
      channel,
      otpHash,
      expiresAt,
    });

    try {
      if (channel === 'email') {
        await sendEmailOtp(normalizedIdentifier, otp);
      } else {
        await sendSmsOtp(normalizedIdentifier, otp);
      }
    } catch (error) {
      await PasswordResetOtp.deleteOne({ _id: record._id });
      return res.status(500).json({ message: 'Failed to send OTP' });
    }

    res.json({ message: `OTP sent via ${channel}` });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password/verify-otp', async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }

    const { identifier, otp } = req.body;
    const channel = determineChannel(identifier);
    const normalizedIdentifier = channel === 'email'
      ? normalizeEmail(identifier)
      : normalizePhone(identifier);

    if (!normalizedIdentifier || !otp) {
      return res.status(400).json({ message: 'Identifier and OTP are required' });
    }

    const record = await PasswordResetOtp.findOne({ identifier: normalizedIdentifier, channel })
      .sort({ createdAt: -1 });

    if (!record) {
      return res.status(404).json({ message: 'OTP not found or expired' });
    }

    if (record.expiresAt < new Date()) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    if (record.attempts >= 5) {
      return res.status(429).json({ message: 'Too many attempts. Request a new OTP.' });
    }

    const isMatch = await bcrypt.compare(String(otp), record.otpHash);
    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    record.resetTokenHash = await bcrypt.hash(resetToken, 10);
    record.verifiedAt = new Date();
    await record.save();

    res.json({ message: 'OTP verified', resetToken });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password/reset', async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }

    const { identifier, resetToken, newPassword } = req.body;
    const channel = determineChannel(identifier);
    const normalizedIdentifier = channel === 'email'
      ? normalizeEmail(identifier)
      : normalizePhone(identifier);

    if (!normalizedIdentifier || !resetToken || !newPassword) {
      return res.status(400).json({ message: 'Identifier, reset token, and new password are required' });
    }

    const record = await PasswordResetOtp.findOne({ identifier: normalizedIdentifier, channel })
      .sort({ createdAt: -1 });

    if (!record || !record.resetTokenHash || !record.verifiedAt) {
      return res.status(400).json({ message: 'OTP not verified' });
    }

    if (record.expiresAt < new Date()) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    const tokenMatch = await bcrypt.compare(String(resetToken), record.resetTokenHash);
    if (!tokenMatch) {
      return res.status(401).json({ message: 'Invalid reset token' });
    }

    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    await PasswordResetOtp.deleteMany({ userId: user._id });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Update user profile
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: 'Database not connected' });
    }

    const userId = req.user.id;
    const { name, email, phone, twoFactorEnabled } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (email) updateData.email = String(email).trim().toLowerCase();
    if (phone) updateData.phone = normalizePhone(phone);
    if (typeof twoFactorEnabled === 'boolean') updateData.twoFactorEnabled = twoFactorEnabled;

    const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      message: 'Profile updated successfully'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
