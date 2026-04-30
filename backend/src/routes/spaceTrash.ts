import { Router } from 'express';
import { authenticate, isMember } from '../middleware';
import { canWrite, canManageTrash, toItemResponse } from './spaceUtils';
import { parseSpaceId } from './spacesHelpers';
import {
  getTrashedItems,
  getTrashedItemById,
  permanentlyDeleteTrashedSpaceItem,
  restoreSpaceItemFromTrash,
  emptySpaceTrash,
  purgeExpiredSpaceTrash,
  setItemFolderId,
  getContentHashGroups,
  getPerceptualHashGroups,
} from '../db/spaceItems';
import {
  getFolderById,
  getFolderAncestors,
  getFolderByName,
  createFolder,
  getTrashedFolders,
} from '../db/spaceFolders';
import { PAGE } from '../config';

const toHashGroupResponse = (group: Awaited<ReturnType<typeof getContentHashGroups>>[number]) => ({
  hash: group.hash,
  itemCount: group.itemCount,
  totalSizeBytes: group.totalSizeBytes,
  wastedBytes: group.wastedBytes,
  items: group.items.map((item) => ({
    itemId: item.itemId,
    displayName: item.displayName,
    path: item.path,
    uploadedAt: item.uploadedAt,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    folderId: item.folderId,
    uploadedBy: item.uploadedBy,
  })),
});

const router = Router({ mergeParams: true });

// GET /spaces/:spaceId/trash
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
    const [{ rows, hasMore }, folders] = await Promise.all([
      getTrashedItems({ spaceId, limit, offset }),
      getTrashedFolders({ spaceId }),
    ]);
    res.json({
      items: rows.map((item) => toItemResponse(spaceId, item)),
      folders: folders.map((f) => ({
        folderId: f.id,
        name: f.name,
        trashedAt: f.trashed_at,
        expiresAt: f.expires_at,
      })),
      hasMore,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/duplicates
router.get('/duplicates', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  try {
    const groups = await getContentHashGroups({ spaceId });
    res.json({ groups: groups.map(toHashGroupResponse) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/similars
router.get('/similars', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  try {
    const groups = await getPerceptualHashGroups({ spaceId });
    res.json({ groups: groups.map(toHashGroupResponse) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/trash/:itemId/restore
router.post('/trash/:itemId/restore', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can restore trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemId = typeof req.params.itemId === 'string' ? req.params.itemId : null;

  if (!spaceId || !itemId) {
    res.status(400).json({ error: 'Invalid spaceId or itemId' });
    return;
  }

  try {
    const trashedItem = await getTrashedItemById({ spaceId, itemId });
    if (!trashedItem) {
      res.status(404).json({ error: 'Item not found in trash' });
      return;
    }

    if (trashedItem.folder_id != null) {
      const folder = await getFolderById(trashedItem.folder_id);
      if (!folder || folder.deleted) {
        const ancestors = folder ? await getFolderAncestors(trashedItem.folder_id) : [];
        const chain = folder ? [...ancestors, folder] : ancestors;

        let currentParentId: number | null = null;
        for (const f of chain) {
          if (!f.deleted) {
            currentParentId = f.id;
            continue;
          }
          const existing = await getFolderByName({ spaceId, name: f.name, parentId: currentParentId });
          if (existing && !existing.deleted) {
            currentParentId = existing.id;
          } else {
            const newFolder = await createFolder({
              spaceId,
              createdBy: req.user.id,
              name: f.name,
              parentId: currentParentId,
            });
            currentParentId = newFolder.id;
          }
        }

        if (currentParentId !== trashedItem.folder_id) {
          await setItemFolderId({ spaceId, itemId, folderId: currentParentId });
        }
      }
    }

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

// DELETE /spaces/:spaceId/trash/:itemId
router.delete('/trash/:itemId', authenticate, isMember, async (req, res) => {
  if (!canManageTrash(req.member.role)) {
    res.status(403).json({ error: 'Only admins and moderators can permanently delete trash' });
    return;
  }

  const spaceId = parseSpaceId(req);
  const itemId = typeof req.params.itemId === 'string' ? req.params.itemId : null;

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

// DELETE /spaces/:spaceId/trash
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

export default router;
