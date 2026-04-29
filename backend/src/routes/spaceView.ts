import { Router } from 'express';
import { authenticate, isMember, deltaSync } from '../middleware';
import {
  getSpaceById,
  getSpaceMembers,
  getSpaceItemsForPageView,
  getLikeSummaryForItems,
} from '../db';
import { parseSpaceId } from './spacesHelpers';
import type { SpaceItemFeedCandidate } from '../db/spaceItems';

const router = Router({ mergeParams: true });
const DEFAULT_FEED_LIMIT = 10;
const MAX_FEED_LIMIT = 10;

const hammingDistanceHex = (a: string, b: string): number => {
  let distance = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const xor = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    distance += xor.toString(2).split('1').length - 1;
  }
  return distance + Math.abs(a.length - b.length) * 4;
};

const similarityPenalty = (
  candidate: SpaceItemFeedCandidate,
  selected: SpaceItemFeedCandidate[],
): number => {
  if (!candidate.perceptual_hash) {
    return 0;
  }

  const recentSelected = selected.slice(-6);
  let penalty = 0;
  for (const item of recentSelected) {
    if (!item.perceptual_hash) continue;

    const similarity = 1 - hammingDistanceHex(candidate.perceptual_hash, item.perceptual_hash) / 64;
    if (similarity >= 0.88) {
      penalty += 14;
    } else if (similarity >= 0.78) {
      penalty += 7;
    } else if (similarity >= 0.68) {
      penalty += 3;
    }
  }

  return penalty;
};

const diversifyFeed = (
  candidates: SpaceItemFeedCandidate[],
  limit: number,
): SpaceItemFeedCandidate[] => {
  const remaining = [...candidates];
  const selected: SpaceItemFeedCandidate[] = [];

  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const score = Number(candidate.feed_score) - similarityPenalty(candidate, selected);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });

    const [next] = remaining.splice(bestIndex, 1);
    selected.push(next);
  }

  return selected;
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
    let limit = DEFAULT_FEED_LIMIT;
    if (rawLimit != null) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_FEED_LIMIT) {
        res.status(400).json({ error: `limit must be an integer from 1 to ${MAX_FEED_LIMIT}` });
        return;
      }
    }

    const candidateLimit = Math.max(limit * 5, 80);
    const candidates = await getSpaceItemsForPageView({ spaceId, limit: candidateLimit });
    const items = diversifyFeed(candidates, limit);
    const likeSummary = await getLikeSummaryForItems({
      itemIds: items.map((item) => item.photo_id),
      userId: req.user.id,
    });

    const photos = items.map((item) => ({
      photoId: item.photo_id,
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
