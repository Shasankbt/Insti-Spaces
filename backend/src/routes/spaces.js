const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const authenticate = require('../middleware');
const { pool, getUserSpaceRole, addUserToSpace, findUserByUsername } = require('../db');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// GET /spaces — list spaces the authenticated user follows
router.get('/', authenticate, async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.spacename, f.role
       FROM following f
       JOIN spaces s ON s.id = f.spaceid
       WHERE f.userid = $1
       ORDER BY s.spacename ASC`,
      [userId]
    );
    res.json({ spaces: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /spaces/create — create a space and auto-follow as admin
router.post('/create', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { spacename } = req.body;

  if (!spacename || !spacename.trim()) {
    return res.status(400).json({ error: 'spacename is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO spaces (spacename) VALUES ($1) RETURNING id, spacename, created_at`,
      [spacename.trim()]
    );
    const space = rows[0];

    await client.query(
      `INSERT INTO following (userid, spaceid, role) VALUES ($1, $2, 'admin')`,
      [userId, space.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ space });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Space name already taken' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /spaces/join?token=... — join a space via invite link
router.get('/join', authenticate, async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Invalid or expired invite token' });
  }

  if (payload.type !== 'space-invite') {
    return res.status(400).json({ error: 'Invalid token type' });
  }

  try {
    await addUserToSpace({ spaceId: payload.spaceId, userId: req.user.id });
    res.json({ message: 'Joined space', spaceId: payload.spaceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /spaces/:spaceId/leave — leave a space
router.delete('/:spaceId/leave', authenticate, async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  if (!Number.isFinite(spaceId)) {
    return res.status(400).json({ error: 'Invalid spaceId' });
  }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM following WHERE spaceid = $1 AND userid = $2`,
      [spaceId, req.user.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'You are not a member of this space' });
    }
    res.json({ message: 'Left space' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /spaces/:spaceId/invite — directly add a user to the space (by userId or username)
router.post('/:spaceId/invite', authenticate, async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const { userId, username } = req.body;

  if (!Number.isFinite(spaceId) || (!userId && !username)) {
    return res.status(400).json({ error: 'spaceId and userId or username are required' });
  }

  const requesterRole = await getUserSpaceRole({ spaceId, userId: req.user.id });
  if (requesterRole !== 'admin') {
    return res.status(403).json({ error: 'Only admins can invite' });
  }

  try {
    let targetId = userId ? Number(userId) : null;
    if (!targetId && username) {
      const found = await findUserByUsername(username.trim());
      if (!found) return res.status(404).json({ error: 'User not found' });
      targetId = found.id;
    }
    await addUserToSpace({ spaceId, userId: targetId });
    res.json({ message: 'User invited' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /spaces/:spaceId/invite-link — generate a signed invite link
router.post('/:spaceId/invite-link', authenticate, async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  if (!Number.isFinite(spaceId)) {
    return res.status(400).json({ error: 'Invalid spaceId' });
  }

  const requesterRole = await getUserSpaceRole({ spaceId, userId: req.user.id });
  if (requesterRole !== 'admin') {
    return res.status(403).json({ error: 'Only admins can generate invite links' });
  }

  const token = jwt.sign(
    { type: 'space-invite', spaceId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const inviteLink = `http://localhost:5173/spaces/join?token=${token}`;
  res.json({ inviteLink });
});

// POST /spaces/:spaceId/contribute — upload photos to a space
router.post(
  '/:spaceId/contribute',
  authenticate,
  upload.array('photos', 10),
  async (req, res) => {
    const spaceId = Number(req.params.spaceId);
    if (!Number.isFinite(spaceId)) {
      return res.status(400).json({ error: 'Invalid spaceId' });
    }

    const role = await getUserSpaceRole({ spaceId, userId: req.user.id });
    if (!['admin', 'moderator', 'contributor'].includes(role)) {
      return res.status(403).json({ error: 'Only admins, moderators, and contributors can post' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos uploaded' });
    }

    try {
      const inserted = await Promise.all(
        req.files.map(async (file) => {
          const photoUrl = `/uploads/${file.filename}`;
          const { rows } = await pool.query(
            `INSERT INTO space_posts (spaceid, userid, photo_url)
             VALUES ($1, $2, $3) RETURNING id, photo_url, created_at`,
            [spaceId, req.user.id, photoUrl]
          );
          return rows[0];
        })
      );
      res.status(201).json({ posts: inserted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
