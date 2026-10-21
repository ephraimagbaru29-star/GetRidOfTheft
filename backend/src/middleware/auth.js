const jwt = require('jsonwebtoken');

/**
 * Middleware: require a valid JWT in Authorization: Bearer <token>
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.staff = payload; // { id, username, role, display_name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
}

/**
 * Middleware: require owner role (use after requireAuth).
 */
function requireOwner(req, res, next) {
  if (req.staff.role !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' });
  }
  next();
}

module.exports = { requireAuth, requireOwner };
