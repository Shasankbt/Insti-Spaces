import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { authenticate, isMember, upload } from '../middleware';
import { addSpaceItem } from '../db/spaceItems';
import { getFolderById } from '../db/spaceFolders';

const router = Router({ mergeParams: true });
const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

const handleUpload = async (req: Request, res: Response) => {
  if (!['contributor', 'moderator', 'admin'].includes(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can upload items' });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const hasNonImage = files.some((file) => !file.mimetype.startsWith('image/'));
  if (hasNonImage) {
    res.status(400).json({ error: 'Only image files are allowed' });
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
    const thumbnailDirAbs = path.resolve(UPLOADS_ROOT, 'spaces', String(spaceId), 'thumbnails');
    await fs.mkdir(thumbnailDirAbs, { recursive: true });

    const items = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join('spaces', String(spaceId), 'originals', file.filename);
        const thumbnailFilename = `${path.parse(file.filename).name}.webp`;
        const thumbnailPath = path.join('spaces', String(spaceId), 'thumbnails', thumbnailFilename);
        const photoUrl = `/uploads/${filePath}`;
        const thumbnailUrl = `/uploads/${thumbnailPath}`;

        await sharp(file.path)
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(thumbnailDirAbs, thumbnailFilename));

        console.log(
          '[space-items/upload] Generated URLs',
          JSON.stringify({
            spaceId,
            uploaderId: req.user.id,
            originalName: file.originalname,
            photoUrl,
            thumbnailUrl,
          }),
        );

        return addSpaceItem({
          spaceId,
          uploaderId: req.user.id,
          folderId,
          filePath,
          thumbnailPath,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          displayName: file.originalname,
          capturedAt: null,
        });
      }),
    );
    res.status(201).json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
};

// POST /spaces/:spaceId/upload — upload photos to a space (contributor+)
router.post('/upload', authenticate, isMember, upload.array('items', 20), handleUpload);

export default router;
