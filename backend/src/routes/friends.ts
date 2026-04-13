import { Router, Request, Response } from 'express';
import { authenticate, deltaSync } from '../middleware';
import { findUserByUsername, createFriendRequest, acceptFriendRequest, listFriends } from '../db';

const router = Router();

const getFriendsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const friends = await listFriends({ userId: req.user.id, limit, since: req.since });
    res.json({ friends });
  } catch (err: unknown) {
    const statusErr = err as { statusCode?: number; message?: string };
    const code =
      statusErr.statusCode && Number.isInteger(statusErr.statusCode) ? statusErr.statusCode : 500;
    res.status(code).json({ error: statusErr.message || 'Failed to load friends' });
  }
};

// get friends (GET /friends) — supports ?since= for delta sync
router.get('/', authenticate, deltaSync, getFriendsHandler);

// create friend request
router.post('/friend-requests', authenticate, async (req, res) => {
  try {
    const { toUserId, toUsername } = req.body as {
      toUserId?: number;
      toUsername?: string;
    };
    const fromUserId = req.user.id;

    let recipientId: number | undefined = toUserId;
    if (!recipientId && toUsername) {
      const user = await findUserByUsername(toUsername.trim());
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      recipientId = user.id;
    }

    if (!recipientId) {
      res.status(400).json({ error: 'toUserId or toUsername required' });
      return;
    }

    const request = await createFriendRequest({ fromUserId, toUserId: recipientId });
    res.status(201).json({ request });
  } catch (err: unknown) {
    const statusErr = err as { message?: string };
    res.status(500).json({ error: statusErr.message || 'Friend request failed' });
  }
});

// accept a friend request
router.post('/friend-requests/:id/accept', authenticate, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId)) {
      res.status(400).json({ error: 'Invalid request id' });
      return;
    }

    const updated = await acceptFriendRequest({ requestId, userId: req.user.id });
    res.json({ request: updated });
  } catch (err: unknown) {
    const statusErr = err as { message?: string };
    res.status(500).json({ error: statusErr.message || 'Failed to accept request' });
  }
});

export default router;
