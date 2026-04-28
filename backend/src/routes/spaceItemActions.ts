import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import { authenticate, isMember } from '../middleware';
import {
  bulkMoveSpaceItemsToTrash,
  bulkMoveSpaceItems,
  getConflictingDisplayNames,
  getItemByDisplayNameInFolder,
  getItemsByIds,
  softDeleteSpaceItem,
  moveAndRenameSpaceItem,
  addSpaceItem,
  getDisplayNamesInFolder,
} from '../db/spaceItems';
import { getFolderById } from '../db/spaceFolders';
import { parseSpaceId } from './spacesHelpers';

const router = Router({ mergeParams: true });
const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

const canWrite = (role: string): boolean => ['contributor', 'moderator', 'admin'].includes(role);
const canManageTrash = (role: string): boolean => ['moderator', 'admin'].includes(role);

type Resolution = 'skip' | 'replace' | 'keep_both';

const uniqueDisplayName = (original: string, taken: Set<string>): string => {
  if (!taken.has(original)) return original;
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  let n = 1;
  while (taken.has(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
};

type ConflictPlan = {
  toProcess: { itemId: string; resolvedName: string; needsRename: boolean }[];
  toSoftDelete: string[];
  skipped: string[];
  unresolved: { itemId: string; displayName: string }[];
};

const planConflicts = async ({
  spaceId,
  folderId,
  items,
  resolutions,
}: {
  spaceId: number;
  folderId: number | null;
  items: { itemId: string; displayName: string }[];
  resolutions: Record<string, Resolution>;
}): Promise<ConflictPlan> => {
  const conflictingNames = new Set(
    await getConflictingDisplayNames({
      spaceId,
      folderId,
      candidateNames: items.map((i) => i.displayName),
    }),
  );

  const takenNames = new Set(await getDisplayNamesInFolder({ spaceId, folderId }));

  const toProcess: ConflictPlan['toProcess'] = [];
  const toSoftDelete: string[] = [];
  const skipped: string[] = [];
  const unresolved: ConflictPlan['unresolved'] = [];

  for (const item of items) {
    const hasConflict = conflictingNames.has(item.displayName);

    if (!hasConflict) {
      toProcess.push({ itemId: item.itemId, resolvedName: item.displayName, needsRename: false });
      takenNames.add(item.displayName);
      continue;
    }

    const resolution = resolutions[item.itemId];

    if (!resolution) {
      unresolved.push({ itemId: item.itemId, displayName: item.displayName });
      continue;
    }

    if (resolution === 'skip') {
      skipped.push(item.itemId);
      continue;
    }

    if (resolution === 'replace') {
      const conflictId = await getItemByDisplayNameInFolder({ spaceId, folderId, displayName: item.displayName });
      if (conflictId) {
        toSoftDelete.push(conflictId);
        // remove old name from taken so the incoming item can claim it
        takenNames.delete(item.displayName);
      }
      toProcess.push({ itemId: item.itemId, resolvedName: item.displayName, needsRename: false });
      takenNames.add(item.displayName);
      continue;
    }

    // keep_both: assign a new unique name
    const newName = uniqueDisplayName(item.displayName, takenNames);
    toProcess.push({ itemId: item.itemId, resolvedName: newName, needsRename: true });
    takenNames.add(newName);
  }

  return { toProcess, toSoftDelete, skipped, unresolved };
};

// POST /spaces/:spaceId/item-action/trash — move items to trash (moderator+)
router.post('/item-action/trash', authenticate, isMember, async (req, res) => {
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

// PATCH /spaces/:spaceId/item-action/move — move items to a folder, with conflict resolution (contributor+)
router.patch('/item-action/move', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can move items' });
    return;
  }

  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const { itemIds, folderId: folderIdRaw, resolutions = {} } = req.body as {
    itemIds?: unknown;
    folderId?: unknown;
    resolutions?: Record<string, Resolution>;
  };

  if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'itemIds must be an array of strings' });
    return;
  }

  if (itemIds.length === 0) {
    res.json({ count: 0, skipped: 0 });
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
    const sourceItems = await getItemsByIds({ spaceId, itemIds });
    const plan = await planConflicts({
      spaceId,
      folderId,
      items: sourceItems.map((i) => ({ itemId: i.photo_id, displayName: i.display_name })),
      resolutions,
    });

    if (plan.unresolved.length > 0) {
      res.status(409).json({ conflicts: plan.unresolved });
      return;
    }

    await Promise.all(plan.toSoftDelete.map((id) => softDeleteSpaceItem({ spaceId, itemId: id })));

    const needRename = plan.toProcess.filter((p) => p.needsRename);
    const noRename = plan.toProcess.filter((p) => !p.needsRename);

    await Promise.all([
      ...needRename.map((p) => moveAndRenameSpaceItem({ spaceId, itemId: p.itemId, folderId, displayName: p.resolvedName })),
      bulkMoveSpaceItems({ spaceId, itemIds: noRename.map((p) => p.itemId), folderId }),
    ]);

    res.json({ count: plan.toProcess.length, skipped: plan.skipped.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/:spaceId/item-action/copy — copy items to a folder, duplicating files (contributor+)
router.post('/item-action/copy', authenticate, isMember, async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can copy items' });
    return;
  }

  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const { itemIds, folderId: folderIdRaw, resolutions = {} } = req.body as {
    itemIds?: unknown;
    folderId?: unknown;
    resolutions?: Record<string, Resolution>;
  };

  if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'itemIds must be an array of strings' });
    return;
  }

  if (itemIds.length === 0) {
    res.json({ count: 0, skipped: 0 });
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
    const sourceItems = await getItemsByIds({ spaceId, itemIds });
    const plan = await planConflicts({
      spaceId,
      folderId,
      items: sourceItems.map((i) => ({ itemId: i.photo_id, displayName: i.display_name })),
      resolutions,
    });

    if (plan.unresolved.length > 0) {
      res.status(409).json({ conflicts: plan.unresolved });
      return;
    }

    await Promise.all(plan.toSoftDelete.map((id) => softDeleteSpaceItem({ spaceId, itemId: id })));

    const uploadsRoot = path.resolve(UPLOADS_ROOT);
    const originalsDir = path.join(uploadsRoot, 'spaces', String(spaceId), 'originals');
    const thumbsDir = path.join(uploadsRoot, 'spaces', String(spaceId), 'thumbnails');
    await fs.mkdir(originalsDir, { recursive: true });
    await fs.mkdir(thumbsDir, { recursive: true });

    const sourceMap = new Map(sourceItems.map((i) => [i.photo_id, i]));

    await Promise.all(
      plan.toProcess.map(async ({ itemId, resolvedName }) => {
        const src = sourceMap.get(itemId);
        if (!src) return;

        const srcFile = path.resolve(uploadsRoot, src.file_path);
        const srcThumb = path.resolve(uploadsRoot, src.thumbnail_path);

        const fileExt = path.extname(src.file_path);
        const thumbExt = path.extname(src.thumbnail_path);
        const newId = crypto.randomUUID();
        const newFileName = `${newId}${fileExt}`;
        const newThumbName = `${newId}${thumbExt}`;

        const newFilePath = path.join('spaces', String(spaceId), 'originals', newFileName);
        const newThumbPath = path.join('spaces', String(spaceId), 'thumbnails', newThumbName);

        await fs.copyFile(srcFile, path.join(originalsDir, newFileName));
        await fs.copyFile(srcThumb, path.join(thumbsDir, newThumbName));

        await addSpaceItem({
          spaceId,
          uploaderId: req.user.id,
          folderId,
          filePath: newFilePath,
          thumbnailPath: newThumbPath,
          contentHash: null,
          mimeType: src.mime_type,
          sizeBytes: src.size_bytes,
          displayName: resolvedName,
          capturedAt: null,
        });
      }),
    );

    res.json({ count: plan.toProcess.length, skipped: plan.skipped.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
