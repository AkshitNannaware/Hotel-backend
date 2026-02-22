const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    phone: { type: String, trim: true, unique: true, sparse: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    passwordHash: { type: String, required: true },
    twoFactorEnabled: { type: Boolean, default: false },
    logoUrl: { type: String, trim: true },
    facebook: { type: String, trim: true },
    instagram: { type: String, trim: true },
    youtube: { type: String, trim: true },
    twitter: { type: String, trim: true },
  },
  { timestamps: true }
);

userSchema.pre('validate', function (next) {
  if (!this.email && !this.phone) {
    this.invalidate('email', 'Email or phone is required');
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
