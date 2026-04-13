import { Router } from 'express';
import { authenticate, isMember, deltaSync } from '../middleware';
import { createFolder, getSpaceFolders, getFolderById } from '../db/spaceFolders';

const router = Router({ mergeParams: true });

// POST /spaces/:spaceId/folders — create a folder (contributor+)
router.post('/folders', authenticate, isMember, async (req, res) => {
  if (!['contributor', 'moderator', 'admin'].includes(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can create folders' });
    return;
  }

  const { name, parent_id } = req.body as { name?: string; parent_id?: number };

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const spaceId = req.member.spaceid;

  // if parent_id provided, verify it belongs to this space
  if (parent_id != null) {
    const parent = await getFolderById(parent_id);
    if (!parent || parent.space_id !== spaceId || parent.deleted) {
      res.status(404).json({ error: 'Parent folder not found' });
      return;
    }
  }

  try {
    const folder = await createFolder({
      spaceId,
      createdBy: req.user.id,
      name: name.trim(),
      parentId: parent_id ?? null,
    });
    res.status(201).json({ folder });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/folders — list folders for delta sync (all members)
router.get('/folders', authenticate, isMember, deltaSync, async (req, res) => {
  try {
    const folders = await getSpaceFolders(req.member.spaceid, req.since);
    res.json({ folders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
