import { Router } from 'express';
import { authenticate, isMember } from '../middleware';
import { parseSpaceId } from './spacesHelpers';
import {
  isLikeableSpaceItemInSpace,
  likeSpaceItem,
  unlikeSpaceItem,
  getLikeSummaryForItems,
} from '../db/spaceItems';

const router = Router({ mergeParams: true });

// POST /spaces/:spaceId/items/:itemId/like
router.post('/items/:itemId/like', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const itemId = typeof req.params.itemId === 'string' ? req.params.itemId : null;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  try {
    const exists = await isLikeableSpaceItemInSpace({ itemId, spaceId });
    if (!exists) {
      res.status(404).json({ error: 'Item not found in this space' });
      return;
    }

    await likeSpaceItem({ itemId, userId: req.user.id });
    const summary = await getLikeSummaryForItems({ itemIds: [itemId], userId: req.user.id });
    res.json(summary.get(itemId) ?? { likeCount: 0, likedByMe: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /spaces/:spaceId/items/:itemId/like
router.delete('/items/:itemId/like', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const itemId = typeof req.params.itemId === 'string' ? req.params.itemId : null;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  try {
    const exists = await isLikeableSpaceItemInSpace({ itemId, spaceId });
    if (!exists) {
      res.status(404).json({ error: 'Item not found in this space' });
      return;
    }

    await unlikeSpaceItem({ itemId, userId: req.user.id });
    const summary = await getLikeSummaryForItems({ itemIds: [itemId], userId: req.user.id });
    res.json(summary.get(itemId) ?? { likeCount: 0, likedByMe: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
