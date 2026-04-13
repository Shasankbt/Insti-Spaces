import { Router } from 'express';
import path from 'path';
import { authenticate, isMember, upload } from '../middleware';
import { addSpaceItem } from '../db/spaceItems';
import { getFolderById } from '../db/spaceFolders';

const router = Router({ mergeParams: true });

// POST /spaces/:spaceId/items/upload — upload photos to a space (contributor+)
router.post('/items/upload', authenticate, isMember, upload.array('items', 20), async (req, res) => {
  if (!['contributor', 'moderator', 'admin'].includes(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can upload items' });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const spaceId = req.member.spaceid;

  // optional folder_id — if omitted, item lands at space root
  const rawFolderId = (req.body as { folder_id?: string }).folder_id;
  let folderId: number | null = null;

  if (rawFolderId != null) {
    folderId = Number(rawFolderId);
    if (!Number.isFinite(folderId)) {
      res.status(400).json({ error: 'Invalid folder_id' });
      return;
    }
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      res.status(404).json({ error: 'Folder not found in this space' });
      return;
    }
  }

  try {
    const items = await Promise.all(
      files.map((file) => {
        const filePath = path.join('spaces', String(spaceId), 'originals', file.filename);
        return addSpaceItem({
          spaceId,
          uploaderId: req.user.id,
          folderId,
          filePath,
          thumbnailPath: filePath,  // TODO: replace with generated thumbnail path
          mimeType: file.mimetype,
          sizeBytes: file.size,
          displayName: file.originalname,
          capturedAt: null,         // TODO: parse with exifr once installed
        });
      }),
    );
    res.status(201).json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
