const router = require('express').Router();
const authenticate = require('../middleware');

// create friend request
router.post('/friend-requests', authenticate, async (req, res) => {
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

// accept a friend request
router.post('/friend-requests/:id/accept', authenticate, async (req, res) => {
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

module.exports = router;