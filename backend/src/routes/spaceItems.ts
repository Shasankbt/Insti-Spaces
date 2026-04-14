import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { authenticate, isMember, upload } from '../middleware';
import { addSpaceItem } from '../db/spaceItems';
import { getFolderById } from '../db/spaceFolders';

const router = Router({ mergeParams: true });
const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const isImageMime = (mimeType: string): boolean => mimeType.startsWith('image/');
const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');
const isSupportedMime = (mimeType: string): boolean => isImageMime(mimeType) || isVideoMime(mimeType);

const generateVideoThumbnail = async ({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf', 'thumbnail,scale=320:-1', '-frames:v', '1'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

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

  const hasUnsupportedMedia = files.some((file) => !isSupportedMime(file.mimetype));
  if (hasUnsupportedMedia) {
    res.status(400).json({ error: 'Only image and video files are allowed' });
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
        const thumbnailExt = isVideoMime(file.mimetype) ? '.jpg' : '.webp';
        const thumbnailFilename = `${path.parse(file.filename).name}${thumbnailExt}`;
        const thumbnailPath = path.join('spaces', String(spaceId), 'thumbnails', thumbnailFilename);

        const thumbnailAbsPath = path.join(thumbnailDirAbs, thumbnailFilename);
        if (isVideoMime(file.mimetype)) {
          await generateVideoThumbnail({ inputPath: file.path, outputPath: thumbnailAbsPath });
        } else {
          await sharp(file.path)
            .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(thumbnailAbsPath);
        }

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
