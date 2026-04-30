import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { authenticate, deltaSync, isMember } from '../middleware';
import { upload } from '../upload';
import { PAGE, UPLOAD } from '../config';
import {
  getDisplayNamesInFolder,
  getExistingContentHashes,
  getItemById,
  getItemsInFolderPage,
  getItemsInFolderSince,
  getLikeSummaryForItems,
  renameSpaceItem,
} from '../db/spaceItems';
import {
  getFolderAncestors,
  getFolderByName,
  getFolderById,
} from '../db/spaceFolders';
import { parseSpaceId } from './spacesHelpers';
import { validateContentHashes } from '../validation';
import { canWrite, uniqueDisplayName, toItemResponse } from './spaceUtils';
import { isVideoMime, isMediaMime, detectMimeFromMagicBytes } from '../utils/media';
import { storage } from '../storage';
import { spaceItemService } from '../services';

const router = Router({ mergeParams: true });

const cleanupUploadedFiles = async (files: Express.Multer.File[]): Promise<void> => {
  await Promise.all(
    files.map(async (file) => {
      try {
        await fs.unlink(file.path);
      } catch (err: unknown) {
        const fsErr = err as { code?: string };
        if (fsErr.code !== 'ENOENT') throw err;
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

const commitUploadedMediaFile = async ({
  file,
  spaceId,
  folderId,
  displayName,
  contentHash,
  uploaderId,
}: {
  file: Express.Multer.File;
  spaceId: number;
  folderId: number | null;
  displayName: string;
  contentHash: string | null;
  uploaderId: number;
}) =>
  spaceItemService.commitFile({
    inputPath: file.path,
    storageFilename: file.filename,
    spaceId,
    folderId,
    displayName,
    contentHash,
    uploaderId,
    sizeBytes: file.size,
    mimeType: file.mimetype,
  });

const handleUpload = async (req: Request, res: Response) => {
  console.log('Handling upload for user', req.user.id, 'with member role', req.member.role);
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

  const uploadSessionId = randomUUID();

  try {
    const existingNames = await getDisplayNamesInFolder({ spaceId, folderId });
    const takenNames = new Set(existingNames);
    const displayNames = files.map((file) => {
      const name = uniqueDisplayName(file.originalname, takenNames);
      takenNames.add(name);
      return name;
    });

    const items = await Promise.all(
      files.map((file, fileIndex) =>
        commitUploadedMediaFile({
          file,
          spaceId,
          folderId,
          displayName: displayNames[fileIndex],
          contentHash: contentHashes[fileIndex] ?? null,
          uploaderId: req.user.id,
        }),
      ),
    );
    res.status(201).json({ items, uploadSessionId, uploadedCount: items.length, totalCount: files.length });
  } catch (err: unknown) {
    await cleanupUploadedFiles(files);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
};

// GET /spaces/:spaceId/explorer
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

// GET /spaces/:spaceId/items
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
      const likeSummary = await getLikeSummaryForItems({
        itemIds: rows.map((item) => item.photo_id),
        userId: req.user.id,
      });
      const items = rows.map((item) => ({
        ...toItemResponse(spaceId, item),
        likeCount: likeSummary.get(item.photo_id)?.likeCount ?? 0,
        likedByMe: likeSummary.get(item.photo_id)?.likedByMe ?? false,
        updated_at: item.updated_at,
        deleted: false,
      }));
      const nc = nextCursor ? Buffer.from(JSON.stringify(nextCursor)).toString('base64url') : null;
      res.json({ items, nextCursor: nc });
    } else {
      const rawItems = await getItemsInFolderSince({ spaceId, folderId, since: req.since });
      const likeSummary = await getLikeSummaryForItems({
        itemIds: rawItems.map((item) => item.photo_id),
        userId: req.user.id,
      });
      const items = rawItems.map((item) => ({
        ...toItemResponse(spaceId, item),
        likeCount: likeSummary.get(item.photo_id)?.likeCount ?? 0,
        likedByMe: likeSummary.get(item.photo_id)?.likedByMe ?? false,
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

// GET /spaces/:spaceId/items/:itemId/file
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
    let absolutePath: string;
    try {
      absolutePath = storage.resolveAbsolute(item.file_path);
    } catch {
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

// GET /spaces/:spaceId/items/:itemId/thumbnail
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
    let absolutePath: string;
    try {
      absolutePath = storage.resolveAbsolute(item.thumbnail_path);
    } catch {
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

// POST /spaces/:spaceId/upload
router.post('/upload', authenticate, isMember, upload.array('items', UPLOAD.MAX_FILES), handleUpload);

// POST /spaces/:spaceId/items/hash-check
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
    const existingHashes = await getExistingContentHashes({ spaceId, hashes });
    res.json({ existingHashes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /spaces/:spaceId/items/:itemId/rename
router.patch('/items/:itemId/rename', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can rename items' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemId = typeof req.params.itemId === 'string' ? req.params.itemId : null;
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

export default router;
