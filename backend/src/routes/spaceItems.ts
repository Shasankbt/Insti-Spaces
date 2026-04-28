import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import archiver from 'archiver';
import rateLimit from 'express-rate-limit';
import { authenticate, deltaSync, isMember, upload } from '../middleware';
import { PAGE, RATE, TRASH, UPLOAD } from '../config';
import {
  addSpaceItem,
  bulkMoveSpaceItems,
  bulkMoveSpaceItemsToTrash,
  getExistingContentHashes,
  getItemById,
  getItemsByIds,
  getItemsInFolderPage,
  getItemsInFolderSince,
  getTrashedItems,
  getLikeSummaryForItems,
  emptySpaceTrash,
  isLikeableSpaceItemInSpace,
  likeSpaceItem,
  moveSpaceItem,
  moveSpaceItemToTrash,
  permanentlyDeleteTrashedSpaceItem,
  purgeExpiredSpaceTrash,
  renameSpaceItem,
  restoreSpaceItemFromTrash,
} from '../db/spaceItems';
import {
  getFolderAncestors,
  getFolderByName,
  getFolderById,
  getFolderSubtreeItems,
  getFolderSubtreePaths,
} from '../db/spaceFolders';
import { parseSpaceId } from './spacesHelpers';
import { validateContentHashes } from '../validation';

const router = Router({ mergeParams: true });
const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');
const isMediaMime = (mimeType: string): boolean => mimeType.startsWith('image/') || mimeType.startsWith('video/');
const canWrite = (role: string): boolean => ['contributor', 'moderator', 'admin'].includes(role);
const canManageTrash = (role: string): boolean => ['moderator', 'admin'].includes(role);

const uploadLimiter = rateLimit({
  windowMs: RATE.UPLOAD_WINDOW_MS,
  limit: RATE.UPLOAD_MAX,
  message: { error: 'Upload rate limit exceeded, try again in an hour' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const toItemResponse = (_spaceId: number, item: {
  photo_id: string;
  display_name: string;
  uploaded_at: Date;
  mime_type: string;
  size_bytes: number;
  folder_id: number | null;
  trashed_at?: Date | null;
}) => {
  const trashedAt = item.trashed_at ?? null;
  const expiresAt = trashedAt ? new Date(trashedAt.getTime() + TRASH.EXPIRY_DAYS * 24 * 60 * 60 * 1000) : null;

  return {
    itemId: item.photo_id,
    displayName: item.display_name,
    uploadedAt: item.uploaded_at,
    mimeType: item.mime_type,
    sizeBytes: item.size_bytes,
    folderId: item.folder_id,
    trashedAt,
    expiresAt,
  };
};

const generateVideoThumbnail = async ({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf', `thumbnail,scale=${UPLOAD.THUMB_PX}:-1`, '-frames:v', '1'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

// Remux MP4 so the moov atom is at the front, enabling instant seeking via range requests.
// Uses stream copy (no re-encode), so it's fast regardless of file size.
const applyMp4Faststart = async (inputPath: string): Promise<void> => {
  const tmpPath = `${inputPath}.faststart.tmp`;
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-movflags', '+faststart', '-c', 'copy'])
      .output(tmpPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
  await fs.rename(tmpPath, inputPath);
};

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

const detectMimeFromMagicBytes = (bytes: Uint8Array): string | null => {
  if (bytes.length < 12) return null;

  if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47])) return 'image/png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x42, 0x4D])) return 'image/bmp';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }

  if ((startsWith(bytes, [0x49, 0x49, 0x2A, 0x00])) || (startsWith(bytes, [0x4D, 0x4D, 0x00, 0x2A]))) {
    return 'image/tiff';
  }

  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'].includes(brand)) {
      return brand === 'avif' ? 'image/avif' : 'image/heic';
    }
    return 'video/mp4';
  }

  if (startsWith(bytes, [0x1A, 0x45, 0xDF, 0xA3])) return 'video/webm';
  return null;
};

const cleanupUploadedFiles = async (files: Express.Multer.File[]): Promise<void> => {
  await Promise.all(
    files.map(async (file) => {
      try {
        await fs.unlink(file.path);
      } catch (err: unknown) {
        const fsErr = err as { code?: string };
        if (fsErr.code !== 'ENOENT') {
          throw err;
        }
      }
    }),
  );
};

const validateUploadedFileSignatures = async (
  files: Express.Multer.File[],
): Promise<{ valid: true } | { valid: false; error: string }> => {
  for (const file of files) {
    if (!isMediaMime(file.mimetype)) {
      return { valid: false, error: 'Only image and video files are allowed' };
    }

    const handle = await fs.open(file.path, 'r');
    const header = Buffer.alloc(64);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }

    const detectedMime = detectMimeFromMagicBytes(header);

    if (!detectedMime || !isMediaMime(detectedMime)) {
      return { valid: false, error: `Unsupported file content for ${file.originalname}` };
    }

    const declaredIsVideo = isVideoMime(file.mimetype);
    const detectedIsVideo = isVideoMime(detectedMime);
    if (declaredIsVideo !== detectedIsVideo) {
      return { valid: false, error: `MIME type mismatch for ${file.originalname}` };
    }

    file.mimetype = detectedMime;
  }

  return { valid: true };
};

const handleUpload = async (req: Request, res: Response) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can upload items' });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const signatureValidation = await validateUploadedFileSignatures(files);
  if (!signatureValidation.valid) {
    await cleanupUploadedFiles(files);
    res.status(400).json({ error: signatureValidation.error });
    return;
  }

  const spaceId = req.member.spaceid;
  const rawContentHashes = (req.body as { content_hashes?: string }).content_hashes;
  let contentHashes: Array<string | null> = [];

  if (rawContentHashes != null) {
    try {
      const parsed = JSON.parse(rawContentHashes) as unknown;
      const parsedHashes = validateContentHashes(parsed);
      if (!parsedHashes.success) {
        await cleanupUploadedFiles(files);
        res.status(400).json({ error: parsedHashes.error });
        return;
      }

      contentHashes = parsedHashes.data;
      if (contentHashes.length !== files.length) {
        await cleanupUploadedFiles(files);
        res.status(400).json({ error: 'content_hashes count must match uploaded items' });
        return;
      }
    } catch {
      await cleanupUploadedFiles(files);
      res.status(400).json({ error: 'Invalid content_hashes payload' });
      return;
    }
  }

  // optional folder_id — if omitted, item lands at space root
  const rawFolderId = (req.body as { folder_id?: string }).folder_id;
  let folderId: number | null = null;

  if (rawFolderId != null) {
    folderId = Number(rawFolderId);
    if (!Number.isFinite(folderId)) {
      await cleanupUploadedFiles(files);
      res.status(400).json({ error: 'Invalid folder_id' });
      return;
    }
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      await cleanupUploadedFiles(files);
      res.status(404).json({ error: 'Folder not found in this space' });
      return;
    }
  }

  try {
    const thumbnailDirAbs = path.resolve(UPLOADS_ROOT, 'spaces', String(spaceId), 'thumbnails');
    await fs.mkdir(thumbnailDirAbs, { recursive: true });

    const items = await Promise.all(
      files.map(async (file, fileIndex) => {
        const filePath = path.join('spaces', String(spaceId), 'originals', file.filename);
        const thumbnailExt = isVideoMime(file.mimetype) ? '.jpg' : '.webp';
        const thumbnailFilename = `${path.parse(file.filename).name}${thumbnailExt}`;
        const thumbnailPath = path.join('spaces', String(spaceId), 'thumbnails', thumbnailFilename);

        const thumbnailAbsPath = path.join(thumbnailDirAbs, thumbnailFilename);
        if (isVideoMime(file.mimetype)) {
          await generateVideoThumbnail({ inputPath: file.path, outputPath: thumbnailAbsPath });
          if (file.mimetype === 'video/mp4') {
            await applyMp4Faststart(file.path);
          }
        } else {
          await sharp(file.path)
            .resize(UPLOAD.THUMB_PX, UPLOAD.THUMB_PX, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: UPLOAD.THUMB_QUALITY })
            .toFile(thumbnailAbsPath);
        }

        return addSpaceItem({
          spaceId,
          uploaderId: req.user.id,
          folderId,
          filePath,
          thumbnailPath,
          contentHash: contentHashes[fileIndex] ?? null,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          displayName: file.originalname,
          capturedAt: null,
        });
      }),
    );
    res.status(201).json({ items });
  } catch (err: unknown) {
    await cleanupUploadedFiles(files);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
};

// GET /spaces/:spaceId/explorer?path=FolderA/SubfolderB
//
// Translates a human-readable URL path (e.g. "FolderA/SubfolderB") into folder
// metadata (id, name, parentId) and breadcrumbs. Does NOT return file items.
//
// Called by the frontend whenever the user navigates into a folder. The folder
// names in the URL are resolved one segment at a time against the DB, so the
// response gives the integer folder_id needed to then call GET /items?folder_id=<n>.
//
// Returns: { currentFolder: { id, name, parentId } | null, breadcrumbs: [...] }
router.get('/explorer', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  const segments = rawPath
    ? rawPath.split('/').map((s) => decodeURIComponent(s).trim()).filter(Boolean)
    : [];

  try {
    let folderId: number | null = null;
    let currentFolder = null;

    for (const segment of segments) {
      const folder = await getFolderByName({ spaceId, name: segment, parentId: folderId });
      if (!folder) {
        res.status(404).json({ error: `Folder "${segment}" not found` });
        return;
      }
      folderId = folder.id;
      currentFolder = folder;
    }

    const breadcrumbs = folderId != null ? await getFolderAncestors(folderId) : [];

    const toFolder = (f: { id: number; name: string; parent_id: number | null }) => ({
      id: f.id,
      name: f.name,
      parentId: f.parent_id,
    });

    res.json({
      currentFolder: currentFolder ? toFolder(currentFolder) : null,
      breadcrumbs: breadcrumbs.map(toFolder),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/items?folder_id=<n>&since=<iso>&cursor=<b64>&limit=<n>
// Initial/load-more: since=EPOCH or cursor present → cursor pagination
// Delta sync: since>EPOCH, no cursor → return changed items only
router.get('/items', authenticate, isMember, deltaSync, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const rawFolderId = req.query.folder_id as string | undefined;
  let folderId: number | null = null;
  if (rawFolderId != null && rawFolderId !== '' && rawFolderId !== 'null') {
    folderId = Number(rawFolderId);
    if (!Number.isFinite(folderId)) {
      res.status(400).json({ error: 'Invalid folder_id' });
      return;
    }
  }

  const cursorRaw = req.query.cursor as string | undefined;
  const limitRaw = req.query.limit as string | undefined;
  const limit = Math.min(Number(limitRaw) || PAGE.ITEMS_DEFAULT, PAGE.ITEMS_MAX);
  const isInitialLoad = req.since.getTime() === 0;

  try {
    if (cursorRaw != null || isInitialLoad) {
      let cursor: { at: string; id: string } | null = null;
      if (cursorRaw) {
        try {
          cursor = JSON.parse(Buffer.from(cursorRaw, 'base64url').toString()) as { at: string; id: string };
        } catch {
          res.status(400).json({ error: 'Invalid cursor' });
          return;
        }
      }
      const { rows, nextCursor } = await getItemsInFolderPage({ spaceId, folderId, limit, cursor });
      const items = rows.map((item) => ({
        ...toItemResponse(spaceId, item),
        updated_at: item.updated_at,
        deleted: false,
      }));
      const nc = nextCursor ? Buffer.from(JSON.stringify(nextCursor)).toString('base64url') : null;
      res.json({ items, nextCursor: nc });
    } else {
      const rawItems = await getItemsInFolderSince({ spaceId, folderId, since: req.since });
      const items = rawItems.map((item) => ({
        ...toItemResponse(spaceId, item),
        updated_at: item.updated_at,
        deleted: item.deleted || item.trashed_at != null,
      }));
      res.json({ items, nextCursor: null });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/items/:itemId/file — serve item file by ID (no path exposed to client)
// Accepts ?t=<token> so native <video> range requests work.
router.get('/items/:itemId/file', (req, res, next) => {
  if (!req.headers.authorization && req.query.t) {
    req.headers.authorization = `Bearer ${req.query.t as string}`;
  }
  next();
}, authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const itemId = req.params.itemId as string;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  try {
    const item = await getItemById({ spaceId, itemId });
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const uploadsRoot = path.resolve(UPLOADS_ROOT);
    const absolutePath = path.resolve(uploadsRoot, item.file_path);
    if (!absolutePath.startsWith(`${uploadsRoot}${path.sep}`)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/items/:itemId/thumbnail — serve item thumbnail by ID
router.get('/items/:itemId/thumbnail', (req, res, next) => {
  if (!req.headers.authorization && req.query.t) {
    req.headers.authorization = `Bearer ${req.query.t as string}`;
  }
  next();
}, authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const itemId = req.params.itemId as string;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  try {
    const item = await getItemById({ spaceId, itemId });
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const uploadsRoot = path.resolve(UPLOADS_ROOT);
    const absolutePath = path.resolve(uploadsRoot, item.thumbnail_path);
    if (!absolutePath.startsWith(`${uploadsRoot}${path.sep}`)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Thumbnail not found' });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/upload — upload photos to a space (contributor+)
router.post('/upload', authenticate, isMember, uploadLimiter, upload.array('items', UPLOAD.MAX_FILES), handleUpload);

// POST /spaces/:spaceId/items/hash-check — return already-existing content hashes in this space
router.post('/items/hash-check', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const hashes = (req.body as { hashes?: unknown }).hashes;

  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  if (!Array.isArray(hashes) || !hashes.every((value) => typeof value === 'string')) {
    res.status(400).json({ error: 'hashes must be a string array' });
    return;
  }

  try {
    const existingHashes = await getExistingContentHashes({
      spaceId,
      hashes,
    });
    res.json({ existingHashes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/trash?limit=50&offset=0 — paginated trash list
router.get('/trash', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || PAGE.TRASH_DEFAULT, PAGE.TRASH_MAX);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    await purgeExpiredSpaceTrash({ spaceId });
    const { rows, hasMore } = await getTrashedItems({ spaceId, limit, offset });
    res.json({ items: rows.map((item) => toItemResponse(spaceId, item)), hasMore });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/trash/:itemId/restore — restore an item to its original folder
router.post('/trash/:itemId/restore', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only admins and moderators can restore trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemIdRaw = req.params.itemId;
  const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : null;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  try {
    const item = await restoreSpaceItemFromTrash({ spaceId, itemId });
    if (!item) {
      res.status(404).json({ error: 'Item not found in trash' });
      return;
    }
    res.json({ item: toItemResponse(spaceId, item) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /spaces/:spaceId/trash/:itemId — permanently delete one trashed item
router.delete('/trash/:itemId', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only admins and moderators can permanently delete trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemIdRaw = req.params.itemId;
  const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : null;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  try {
    const deleted = await permanentlyDeleteTrashedSpaceItem({ spaceId, itemId });
    if (!deleted) {
      res.status(404).json({ error: 'Item not found in trash' });
      return;
    }
    res.json({ message: 'Item permanently deleted' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /spaces/:spaceId/trash — permanently delete all trashed items
router.delete('/trash', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only admins and moderators can empty trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  try {
    const deletedCount = await emptySpaceTrash({ spaceId });
    res.json({ message: 'Trash emptied', deletedCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/download — stream a ZIP of selected items and/or folders
router.post('/download', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const { itemIds = [], folderIds = [] } = req.body as {
    itemIds?: string[];
    folderIds?: number[];
  };

  if (itemIds.length === 0 && folderIds.length === 0) {
    res.status(400).json({ error: 'No items or folders selected' });
    return;
  }

  try {
    const [directItems, folderItems, folderPaths] = await Promise.all([
      getItemsByIds({ spaceId, itemIds }),
      getFolderSubtreeItems({ spaceId, folderIds }),
      getFolderSubtreePaths({ spaceId, folderIds }),
    ]);

    const toZip: Array<{ filePath: string; zipPath: string }> = [
      ...directItems.map((item) => ({
        filePath: item.file_path,
        zipPath: item.display_name,
      })),
      ...folderItems.map((item) => ({
        filePath: item.file_path,
        zipPath: `${item.folder_path}/${item.display_name}`,
      })),
    ];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="download.zip"');

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    for (const { folder_path } of folderPaths) {
      archive.append(Buffer.alloc(0), { name: `${folder_path}/` });
    }
    for (const entry of toZip) {
      archive.file(path.resolve(UPLOADS_ROOT, entry.filePath), { name: entry.zipPath });
    }
    await archive.finalize();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/items/:itemId/like — like a media item
router.post('/items/:itemId/like', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const itemIdRaw = req.params.itemId;
  const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : null;

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
    const likeInfo = summary.get(itemId) ?? { likeCount: 0, likedByMe: false };
    res.json(likeInfo);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /spaces/:spaceId/items/:itemId/rename — rename an item (contributor+)
router.patch('/items/:itemId/rename', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can rename items' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemIdRaw = req.params.itemId;
  const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : null;
  const displayNameRaw = (req.body as { displayName?: unknown }).displayName;
  const displayName = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : '';

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }
  if (!displayName) {
    res.status(400).json({ error: 'displayName is required' });
    return;
  }

  try {
    const item = await renameSpaceItem({ spaceId, itemId, displayName });
    if (!item) {
      res.status(404).json({ error: 'Item not found in this space' });
      return;
    }
    res.json({ item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /spaces/:spaceId/items/:itemId/move — move an item to another folder/root (contributor+)
router.patch('/items/:itemId/move', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can move items' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemIdRaw = req.params.itemId;
  const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : null;
  const folderIdRaw = (req.body as { folderId?: unknown }).folderId;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  let folderId: number | null = null;
  if (folderIdRaw != null) {
    if (typeof folderIdRaw !== 'number' || !Number.isFinite(folderIdRaw)) {
      res.status(400).json({ error: 'folderId must be a number or null' });
      return;
    }
    const folder = await getFolderById(folderIdRaw);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      res.status(404).json({ error: 'Target folder not found in this space' });
      return;
    }
    folderId = folderIdRaw;
  }

  try {
    const current = await getItemById({ spaceId, itemId });
    if (!current) {
      res.status(404).json({ error: 'Item not found in this space' });
      return;
    }

    if (current.folder_id === folderId) {
      res.json({ item: current });
      return;
    }

    const item = await moveSpaceItem({ spaceId, itemId, folderId });
    if (!item) {
      res.status(404).json({ error: 'Item not found in this space' });
      return;
    }
    res.json({ item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/items/bulk-trash — move multiple items to trash (moderator+)
router.post('/items/bulk-trash', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only admins and moderators can move items to trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const { itemIds } = req.body as { itemIds?: unknown };
  if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'itemIds must be an array of strings' });
    return;
  }

  if (itemIds.length === 0) {
    res.json({ count: 0 });
    return;
  }

  try {
    const items = await bulkMoveSpaceItemsToTrash({ spaceId, itemIds });
    res.json({ count: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /spaces/:spaceId/items/bulk-move — move multiple items to a folder (contributor+)
router.patch('/items/bulk-move', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can move items' });
    return;
  }

  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const { itemIds, folderId: folderIdRaw } = req.body as { itemIds?: unknown; folderId?: unknown };
  if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'itemIds must be an array of strings' });
    return;
  }

  let folderId: number | null = null;
  if (folderIdRaw != null) {
    if (typeof folderIdRaw !== 'number' || !Number.isFinite(folderIdRaw)) {
      res.status(400).json({ error: 'folderId must be a number or null' });
      return;
    }
    const folder = await getFolderById(folderIdRaw);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      res.status(404).json({ error: 'Target folder not found in this space' });
      return;
    }
    folderId = folderIdRaw;
  }

  if (itemIds.length === 0) {
    res.json({ count: 0 });
    return;
  }

  try {
    const items = await bulkMoveSpaceItems({ spaceId, itemIds, folderId });
    res.json({ count: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /spaces/:spaceId/items/:itemId — move an item to trash (moderator+)
router.delete('/items/:itemId', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only admins and moderators can move items to trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemIdRaw = req.params.itemId;
  const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : null;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  try {
    const item = await moveSpaceItemToTrash({ spaceId, itemId });
    if (!item) {
      res.status(404).json({ error: 'Item not found in this space' });
      return;
    }
    res.json({ message: 'Item moved to trash', item: toItemResponse(spaceId, item) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
