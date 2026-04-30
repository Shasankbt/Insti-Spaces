import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { Router } from 'express';
import { authenticate, isMember, deltaSync } from '../middleware';
import {
  createFolder,
  getSpaceFolders,
  getFolderById,
  getFolderByName,
  getSubfolders,
  isFolderDescendantOf,
  moveFolder,
  softDeleteFolderSubtree,
  restoreFolderSubtree,
  permanentlyDeleteTrashedFolder,
  getTrashedFolderDirectChildren,
  prepareRestoreFolder,
} from '../db/spaceFolders';
import { getItemsInFolder, addSpaceItem } from '../db/spaceItems';

const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

import { canWrite, canManageTrash } from './spaceUtils';

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

  const trimmedName = name.trim();
  const parentId = parent_id ?? null;

  const existing = await getFolderByName({ spaceId, name: trimmedName, parentId });
  if (existing) {
    res.status(409).json({ error: 'A folder with that name already exists here' });
    return;
  }

  try {
    const folder = await createFolder({
      spaceId,
      createdBy: req.user.id,
      name: trimmedName,
      parentId,
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

// PATCH /spaces/:spaceId/folders/:folderId/move — move a folder under another folder/root
router.patch('/folders/:folderId/move', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can move folders' });
    return;
  }

  const folderId = Number(req.params.folderId);
  const { parent_id } = req.body as { parent_id?: number | null };
  const parentId = parent_id ?? null;
  const spaceId = req.member.spaceid;

  if (!Number.isInteger(folderId) || (parentId != null && !Number.isInteger(parentId))) {
    res.status(400).json({ error: 'Invalid folder id' });
    return;
  }

  if (parentId === folderId) {
    res.status(400).json({ error: 'A folder cannot be moved into itself' });
    return;
  }

  try {
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    if (parentId != null) {
      const parent = await getFolderById(parentId);
      if (!parent || parent.space_id !== spaceId || parent.deleted) {
        res.status(404).json({ error: 'Parent folder not found' });
        return;
      }

      if (await isFolderDescendantOf({ folderId: parentId, possibleAncestorId: folderId })) {
        res.status(400).json({ error: 'A folder cannot be moved into one of its subfolders' });
        return;
      }
    }

    const existing = await getFolderByName({ spaceId, name: folder.name, parentId });
    if (existing && existing.id !== folderId) {
      res.status(409).json({ error: 'A folder with that name already exists there' });
      return;
    }

    const moved = await moveFolder({ spaceId, folderId, parentId });
    res.json({ folder: moved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/folders/:folderId/copy — copy folder subtree to a target parent (contributor+)
router.post('/folders/:folderId/copy', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can copy folders' });
    return;
  }

  const spaceId = req.member.spaceid;
  const folderId = Number(req.params.folderId);
  if (!Number.isInteger(folderId)) {
    res.status(400).json({ error: 'Invalid folder id' });
    return;
  }

  const { targetParentId: rawTarget } = req.body as { targetParentId?: unknown };
  let targetParentId: number | null = null;
  if (rawTarget != null) {
    if (typeof rawTarget !== 'number' || !Number.isFinite(rawTarget)) {
      res.status(400).json({ error: 'targetParentId must be a number or null' });
      return;
    }
    targetParentId = rawTarget;
  }

  try {
    const sourceFolder = await getFolderById(folderId);
    if (!sourceFolder || sourceFolder.space_id !== spaceId || sourceFolder.deleted) {
      res.status(404).json({ error: 'Source folder not found' });
      return;
    }

    if (targetParentId != null) {
      const target = await getFolderById(targetParentId);
      if (!target || target.space_id !== spaceId || target.deleted) {
        res.status(404).json({ error: 'Target folder not found' });
        return;
      }
      if (targetParentId === folderId || await isFolderDescendantOf({ folderId: targetParentId, possibleAncestorId: folderId })) {
        res.status(400).json({ error: 'Cannot copy a folder into itself or one of its subfolders' });
        return;
      }
    }

    const uploadsRoot = path.resolve(UPLOADS_ROOT);
    const originalsDir = path.join(uploadsRoot, 'spaces', String(spaceId), 'originals');
    const thumbsDir = path.join(uploadsRoot, 'spaces', String(spaceId), 'thumbnails');
    await fs.mkdir(originalsDir, { recursive: true });
    await fs.mkdir(thumbsDir, { recursive: true });

    let totalItems = 0;

    const copySubtree = async (srcFolderId: number, destParentId: number | null): Promise<void> => {
      const src = await getFolderById(srcFolderId);
      if (!src) return;

      let newName = src.name;
      if (await getFolderByName({ spaceId, name: newName, parentId: destParentId })) {
        let i = 1;
        while (await getFolderByName({ spaceId, name: `${newName}(${i})`, parentId: destParentId })) i++;
        newName = `${newName}(${i})`;
      }

      const newFolder = await createFolder({ spaceId, createdBy: req.user.id, name: newName, parentId: destParentId });

      const items = await getItemsInFolder({ spaceId, folderId: srcFolderId });
      await Promise.all(items.map(async (item) => {
        const newId = crypto.randomUUID();
        const fileExt = path.extname(item.file_path);
        const thumbExt = path.extname(item.thumbnail_path);
        await fs.copyFile(path.resolve(uploadsRoot, item.file_path), path.join(originalsDir, `${newId}${fileExt}`));
        await fs.copyFile(path.resolve(uploadsRoot, item.thumbnail_path), path.join(thumbsDir, `${newId}${thumbExt}`));
        await addSpaceItem({
          spaceId,
          uploaderId: req.user.id,
          folderId: newFolder.id,
          filePath: path.join('spaces', String(spaceId), 'originals', `${newId}${fileExt}`),
          thumbnailPath: path.join('spaces', String(spaceId), 'thumbnails', `${newId}${thumbExt}`),
          contentHash: null,
          perceptualHash: item.perceptual_hash,
          mimeType: item.mime_type,
          sizeBytes: item.size_bytes,
          displayName: item.display_name,
          capturedAt: null,
        });
        totalItems++;
      }));

      const subfolders = await getSubfolders({ spaceId, parentId: srcFolderId });
      for (const sub of subfolders) {
        await copySubtree(sub.id, newFolder.id);
      }
    };

    await copySubtree(folderId, targetParentId);
    res.json({ itemCount: totalItems });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /spaces/:spaceId/folders/:folderId — delete a folder subtree and trash contained items
router.delete('/folders/:folderId', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can delete folders' });
    return;
  }

  const folderId = Number(req.params.folderId);
  const spaceId = req.member.spaceid;
  if (!Number.isInteger(folderId)) {
    res.status(400).json({ error: 'Invalid folder id' });
    return;
  }

  try {
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const result = await softDeleteFolderSubtree({ spaceId, folderId });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/folders/:folderId/restore — restore a trashed folder (contributor+)
router.post('/folders/:folderId/restore', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can restore folders' });
    return;
  }
  const spaceId = req.member.spaceid;
  const folderId = Number(req.params.folderId);
  if (!Number.isInteger(folderId)) { res.status(400).json({ error: 'Invalid folder id' }); return; }
  try {
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || !folder.deleted) {
      res.status(404).json({ error: 'Trashed folder not found' });
      return;
    }

    // Walk up to find the nearest non-deleted ancestor to restore under
    let targetParentId: number | null = folder.parent_id;
    while (targetParentId != null) {
      const parent = await getFolderById(targetParentId);
      if (!parent || parent.deleted) {
        targetParentId = parent ? parent.parent_id : null;
      } else {
        break;
      }
    }

    // Handle name conflict at the target location
    let restoreName = folder.name;
    if (await getFolderByName({ spaceId, name: restoreName, parentId: targetParentId })) {
      let i = 1;
      while (await getFolderByName({ spaceId, name: `${restoreName}(${i})`, parentId: targetParentId })) i++;
      restoreName = `${restoreName}(${i})`;
    }

    if (restoreName !== folder.name || targetParentId !== folder.parent_id) {
      await prepareRestoreFolder({ folderId, name: restoreName, parentId: targetParentId });
    }

    const result = await restoreFolderSubtree({ spaceId, folderId });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

// DELETE /spaces/:spaceId/folders/:folderId/trash — permanently delete a trashed folder (moderator+)
router.delete('/folders/:folderId/trash', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only moderators and admins can permanently delete folders' });
    return;
  }
  const spaceId = req.member.spaceid;
  const folderId = Number(req.params.folderId);
  if (!Number.isInteger(folderId)) { res.status(400).json({ error: 'Invalid folder id' }); return; }
  try {
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || !folder.deleted || !folder.trashed_at) {
      res.status(404).json({ error: 'Trashed folder not found' });
      return;
    }
    await permanentlyDeleteTrashedFolder({ spaceId, folderId });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

// GET /spaces/:spaceId/folders/:folderId/trash-items — direct children of a deleted folder
router.get('/folders/:folderId/trash-items', authenticate, isMember, async (req, res) => {
  const spaceId = req.member.spaceid;
  const folderId = Number(req.params.folderId);
  if (!Number.isInteger(folderId)) { res.status(400).json({ error: 'Invalid folder id' }); return; }
  try {
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || !folder.deleted) {
      res.status(404).json({ error: 'Trashed folder not found' });
      return;
    }
    const { items, subfolders } = await getTrashedFolderDirectChildren({ spaceId, folderId });
    const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
    res.json({
      items: items.map((i) => ({
        itemId: i.photo_id,
        displayName: i.display_name,
        uploadedAt: i.uploaded_at,
        mimeType: i.mime_type,
        sizeBytes: i.size_bytes,
        folderId: i.folder_id,
        trashedAt: i.trashed_at,
        expiresAt: i.trashed_at ? new Date(new Date(i.trashed_at).getTime() + EXPIRY_MS) : null,
      })),
      folders: subfolders,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

export default router;
