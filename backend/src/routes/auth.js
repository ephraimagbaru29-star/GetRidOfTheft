const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { requireAuth, requireOwner } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register  — public self-registration (creates inactive attendant account)
router.post('/register', async (req, res) => {
  const { display_name, username, password } = req.body;
  if (!display_name || !username || !password) {
    return res.status(400).json({ error: 'display_name, username, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO staff_users (display_name, username, role, password_hash, active)
       VALUES ($1, $2, 'attendant', $3, FALSE)
       RETURNING id, display_name, username, role, active, created_at`,
      [display_name.trim(), username.trim().toLowerCase(), hash]
    );
    return res.status(201).json({
      message: 'Account created. An owner must activate it before you can sign in.',
      staff: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  try {
    const result = await query(
      'SELECT * FROM staff_users WHERE username = $1 AND active = TRUE',
      [username.trim().toLowerCase()]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me  — return current user from token
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.staff });
});

// POST /api/auth/staff  — owner creates a new staff account
router.post('/staff', requireAuth, requireOwner, async (req, res) => {
  const { display_name, username, password, role } = req.body;
  if (!display_name || !username || !password) {
    return res.status(400).json({ error: 'display_name, username, and password are required' });
  }
  const allowedRole = ['owner', 'attendant'].includes(role) ? role : 'attendant';
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO staff_users (display_name, username, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, display_name, username, role, active, created_at`,
      [display_name.trim(), username.trim().toLowerCase(), allowedRole, hash]
    );
    return res.status(201).json({ staff: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/staff  — list all staff (owner only)
router.get('/staff', requireAuth, requireOwner, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, display_name, username, role, active, created_at FROM staff_users ORDER BY created_at'
    );
    return res.json({ staff: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/staff/:id  — toggle active / change role
router.patch('/staff/:id', requireAuth, requireOwner, async (req, res) => {
  const { active, role } = req.body;
  const updates = [];
  const params = [];
  if (typeof active === 'boolean') { updates.push(`active = $${params.length + 1}`); params.push(active); }
  if (role && ['owner', 'attendant'].includes(role)) { updates.push(`role = $${params.length + 1}`); params.push(role); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  try {
    const result = await query(
      `UPDATE staff_users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, display_name, username, role, active`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Staff member not found' });
    return res.json({ staff: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
