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
const AGE_BUCKET_DAYS = [1, 7, 30, 180];

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
      penalty += 28;
    } else if (similarity >= 0.78) {
      penalty += 14;
    } else if (similarity >= 0.68) {
      penalty += 7;
    }
  }

  return penalty;
};

const ageBucket = (uploadedAt: Date): string => {
  const ageDays = (Date.now() - uploadedAt.getTime()) / 86_400_000;
  const bucket = AGE_BUCKET_DAYS.find((days) => ageDays <= days);
  return bucket == null ? 'older' : `${bucket}d`;
};

const semanticHint = (displayName: string): string => {
  const name = displayName.toLowerCase();
  if (/\b(selfie|portrait|person|people|group|friend|friends|human|face)\b/.test(name)) {
    return 'people';
  }
  if (/\b(nature|tree|forest|garden|flower|mountain|river|lake|beach|sky|sunset|rain)\b/.test(name)) {
    return 'nature';
  }
  if (/\b(monument|temple|fort|museum|historic|heritage|palace|church|mosque|building)\b/.test(name)) {
    return 'place';
  }
  if (/\b(food|meal|lunch|dinner|breakfast|cafe|restaurant)\b/.test(name)) {
    return 'food';
  }
  if (/\b(doc|document|poster|slide|notice|screenshot|screen)\b/.test(name)) {
    return 'document';
  }
  return 'unknown';
};

const diversityPenalty = (
  candidate: SpaceItemFeedCandidate,
  selected: SpaceItemFeedCandidate[],
): number => {
  let penalty = similarityPenalty(candidate, selected);
  const candidateAgeBucket = ageBucket(candidate.uploaded_at);
  const candidateHint = semanticHint(candidate.display_name);

  for (const item of selected) {
    if (item.uploader_id === candidate.uploader_id) penalty += 2.5;
    if (item.folder_id != null && item.folder_id === candidate.folder_id) penalty += 1.75;
    if (ageBucket(item.uploaded_at) === candidateAgeBucket) penalty += 1.5;

    const itemHint = semanticHint(item.display_name);
    if (candidateHint !== 'unknown' && itemHint === candidateHint) penalty += 2.25;
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
      const score = Number(candidate.feed_score) - diversityPenalty(candidate, selected);
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

    const candidateLimit = Math.max(limit * 20, 200);
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
