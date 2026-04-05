const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware');
const { pool, getUserInSpace } = require('../db');
const { parseSpaceId } = require('./spacesHelpers');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

// POST /spaces/:spaceId/contribute — upload photos to a space
router.post('/contribute', authenticate, upload.array('photos', 10), async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership || !['admin', 'moderator', 'contributor'].includes(membership.role)) {
    return res.status(403).json({ error: 'Only admins, moderators, and contributors can post' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No photos uploaded' });
  }

  try {
    const inserted = await Promise.all(
      req.files.map(async (file) => {
        const { rows } = await pool.query(
          `INSERT INTO space_posts (spaceid, userid, photo_url)
           VALUES ($1, $2, $3) RETURNING id, photo_url, created_at`,
          [spaceId, req.user.id, `/uploads/${file.filename}`]
        );
        return rows[0];
      })
    );
    res.status(201).json({ posts: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
