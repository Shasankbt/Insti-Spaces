const router = require('express').Router();
const { authenticate } = require('../middleware');

const {
  searchUsers,
  listFriendRequests,
} = require('../db');

// display of friend requests
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const items = await listFriendRequests({ userId: req.user.id, limit: 50 });
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// search users by pattern match
router.get('/search', authenticate, async (req, res) => {
  try {
    const prefix = String(req.query.prefix || '').trim();
    const users = await searchUsers({
      prefix,
      excludeUserId: req.user.id,
      limit: 20,
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;