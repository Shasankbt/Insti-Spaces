import { Router } from 'express';
import { authenticate, isMember, deltaSync } from '../middleware';
import { getSpaceById, getSpaceMembers } from '../db';
import { parseSpaceId } from './spacesHelpers';

const router = Router({ mergeParams: true });

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

export default router;
