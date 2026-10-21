/**
 * Face image upload route.
 * POST /api/face/upload  — multipart/form-data with field "face" (image)
 * Returns { path } which is then stored on the job via PATCH /api/jobs/:id/face
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.resolve(__dirname, '../../', process.env.FACE_UPLOAD_DIR || 'uploads/faces');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `face_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted'));
    }
    cb(null, true);
  },
});

// POST /api/face/upload
router.post('/upload', requireAuth, upload.single('face'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  // Return a relative path so the frontend can later display it via /uploads/faces/<filename>
  const relativePath = `uploads/faces/${req.file.filename}`;
  return res.json({ path: relativePath, filename: req.file.filename });
});

module.exports = router;
