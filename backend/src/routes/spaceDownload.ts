import archiver from 'archiver';
import { Router } from 'express';
import { authenticate, isMember } from '../middleware';
import { parseSpaceId } from './spacesHelpers';
import { getItemsByIds } from '../db/spaceItems';
import { getFolderSubtreeItems, getFolderSubtreePaths } from '../db/spaceFolders';
import { storage } from '../storage';

const router = Router({ mergeParams: true });

// POST /spaces/:spaceId/download
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
      ...directItems.map((item) => ({ filePath: item.file_path, zipPath: item.display_name })),
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
      archive.file(storage.resolveAbsolute(entry.filePath), { name: entry.zipPath });
    }
    await archive.finalize();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
