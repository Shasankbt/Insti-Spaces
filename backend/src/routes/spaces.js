const express = require('express');
const router = express.Router();
const authenticate = require('../middleware');
const { pool } = require('../db');

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

module.exports = router;
