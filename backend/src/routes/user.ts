import { Router } from 'express';
import { authenticate, deltaSync } from '../middleware';
import { searchUsers, listNotifications } from '../db';
import { PAGE } from '../config';

const router = Router();

// display of friend requests, role requests
router.get('/notifications', authenticate, deltaSync, async (req, res) => {
  try {
    const items = await listNotifications({ userId: req.user.id, limit: PAGE.NOTIFICATIONS_DEFAULT, since: req.since });
    res.json({ items });
  } catch {
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// search users by pattern match
router.get('/search', authenticate, async (req, res) => {
  try {
    const prefix = String(req.query.prefix ?? '').trim();
    const users = await searchUsers({
      prefix,
      excludeUserId: req.user.id,
      limit: PAGE.USER_SEARCH_MAX,
    });
    res.json({ users });
  } catch {
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
