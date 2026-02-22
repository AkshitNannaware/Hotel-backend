const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing auth token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    console.log('Decoded JWT payload:', payload);
    req.user = payload;
    // Always set req.user.id for compatibility (id, _id, userId)
    req.user.id = payload.id || payload._id || payload.userId;
    return next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
