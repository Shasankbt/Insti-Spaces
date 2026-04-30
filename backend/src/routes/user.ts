import { Router } from 'express';
import { authenticate, deltaSync } from '../middleware';
import {
  searchUsers,
  listNotifications,
  countUnreadNotifications,
  markNotificationsSeen,
} from '../db';
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

// Unread badge count for the navbar — cheap; called on a poll.
router.get('/notifications/unread-count', authenticate, async (req, res) => {
  try {
    const unreadCount = await countUnreadNotifications(req.user.id);
    res.json({ unreadCount });
  } catch {
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

// Bump notifications_seen_at to NOW(); called when the user opens the page.
router.post('/notifications/seen', authenticate, async (req, res) => {
  try {
    await markNotificationsSeen(req.user.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to mark notifications seen' });
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
