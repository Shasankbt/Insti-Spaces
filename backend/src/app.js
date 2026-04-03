const express = require('express');
const app = express();
const cors = require('cors');
const authenticate = require('./middleware');

const {
  findUserByUsername,
  searchUsers,
  createFriendRequest,
  listFriendRequests,
  acceptFriendRequest,
} = require('./db');

app.use(express.json());

app.use(cors({
  origin: 'http://localhost:5173'
}));

app.use('/auth', require('./routes/auth.js'));

// search users by pattern match
app.get('/users/search', authenticate, async (req, res) => {
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

// create friend request
app.post('/friend-requests', authenticate, async (req, res) => {
  try {
    const { toUserId, toUsername } = req.body;
    const fromUserId = req.user.id;

    let recipientId = toUserId;
    if (!recipientId && toUsername) {
      const user = await findUserByUsername(toUsername.trim());
      if (!user) return res.status(404).json({ error: 'User not found' });
      recipientId = user.id;
    }

    if (!recipientId) {
      return res.status(400).json({ error: 'toUserId or toUsername required' });
    }

    const request = await createFriendRequest({
      fromUserId,
      toUserId: recipientId,
    });
    res.status(201).json({ request });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Friend request failed' });
  }
});

// display of friend requests
app.get('/notifications', authenticate, async (req, res) => {
  try {
    const items = await listFriendRequests({ userId: req.user.id, limit: 50 });
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// accept a friend request
app.post('/friend-requests/:id/accept', authenticate, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const updated = await acceptFriendRequest({ requestId, userId: req.user.id });
    res.json({ request: updated });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to accept request' });
  }
});

module.exports = app;