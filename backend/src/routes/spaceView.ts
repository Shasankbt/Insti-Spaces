import { Router } from 'express';
import { authenticate, isMember, deltaSync } from '../middleware';
import {
  getSpaceById,
  getSpaceMembers,
  getSpaceItemsForPageView,
  getLikeSummaryForItems,
} from '../db';
import { parseSpaceId } from './spacesHelpers';
import path from 'path';

const router = Router({ mergeParams: true });

const toMediaUrl = (spaceId: number, storagePath: string): string => {
  const kind = path.basename(path.dirname(storagePath));
  const filename = path.basename(storagePath);
  return `/spaces/${spaceId}/media/${kind}/${encodeURIComponent(filename)}`;
};

// GET /spaces/:spaceId — get space details
router.get('/', authenticate, isMember, async (req, res) => {
  try {
    const spaceId = parseSpaceId(req);
    if (!spaceId) {
      res.status(400).json({ error: 'Invalid spaceId' });
      return;
    }
    const space = await getSpaceById({ spaceId });
    res.json({ space: { ...space, role: req.member.role } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/members — list members of a space
router.get('/members', authenticate, isMember, deltaSync, async (req, res) => {
  try {
    const spaceId = parseSpaceId(req);
    if (!spaceId) {
      res.status(400).json({ error: 'Invalid spaceId' });
      return;
    }
    const members = await getSpaceMembers(spaceId, req.since);
    res.json({ members });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/pageview?limit=20 — get photos (thumbnails) for a space
router.get('/pageview', authenticate, isMember, async (req, res) => {
  try {
    const spaceId = parseSpaceId(req);
    if (!spaceId) {
      res.status(400).json({ error: 'Invalid spaceId' });
      return;
    }

    const rawLimit = req.query.limit as string | undefined;
    let limit: number | undefined;
    if (rawLimit != null) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit <= 0) {
        res.status(400).json({ error: 'limit must be a positive integer' });
        return;
      }
    }

    const items = await getSpaceItemsForPageView({ spaceId, limit });
    const likeSummary = await getLikeSummaryForItems({
      itemIds: items.map((item) => item.photo_id),
      userId: req.user.id,
    });

    const photos = items.map((item) => ({
      photoId: item.photo_id,
      thumbnailUrl: toMediaUrl(spaceId, item.thumbnail_path),
      fileUrl: toMediaUrl(spaceId, item.file_path),
      displayName: item.display_name,
      uploadedAt: item.uploaded_at,
      mimeType: item.mime_type,
      likeCount: likeSummary.get(item.photo_id)?.likeCount ?? 0,
      likedByMe: likeSummary.get(item.photo_id)?.likedByMe ?? false,
    }));

    res.json({ photos });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
