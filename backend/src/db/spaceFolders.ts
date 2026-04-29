import pool from './pool';
import type { SpaceFolder } from '../types';

export const createFolder = async ({
  spaceId,
  createdBy,
  name,
  parentId = null,
}: {
  spaceId: number;
  createdBy: number;
  name: string;
  parentId?: number | null;
}): Promise<SpaceFolder> => {
  const { rows } = await pool.query<SpaceFolder>(
    `INSERT INTO space_folders (space_id, created_by, name, parent_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [spaceId, createdBy, name, parentId],
  );
  return rows[0];
};

export const getSpaceFolders = async (
  spaceId: number,
  since: Date = new Date(0),
): Promise<SpaceFolder[]> => {
  const { rows } = await pool.query<SpaceFolder>(
    `SELECT * FROM space_folders
     WHERE space_id = $1 AND updated_at > $2
     ORDER BY parent_id NULLS FIRST, name ASC`,
    [spaceId, since],
  );
  return rows;
};

export const getFolderById = async (
  folderId: number,
): Promise<SpaceFolder | null> => {
  const { rows } = await pool.query<SpaceFolder>(
    `SELECT * FROM space_folders WHERE id = $1`,
    [folderId],
  );
  return rows[0] ?? null;
};

export const getSubfolders = async ({
  spaceId,
  parentId,
}: {
  spaceId: number;
  parentId: number | null;
}): Promise<SpaceFolder[]> => {
  const { rows } = await pool.query<SpaceFolder>(
    `SELECT * FROM space_folders
     WHERE space_id = $1
       AND deleted = false
       AND parent_id IS NOT DISTINCT FROM $2
     ORDER BY name ASC`,
    [spaceId, parentId],
  );
  return rows;
};

export const getFolderByName = async ({
  spaceId,
  name,
  parentId,
}: {
  spaceId: number;
  name: string;
  parentId: number | null;
}): Promise<SpaceFolder | null> => {
  const { rows } = await pool.query<SpaceFolder>(
    `SELECT * FROM space_folders
     WHERE space_id = $1 AND name = $2 AND deleted = false
       AND parent_id IS NOT DISTINCT FROM $3
     LIMIT 1`,
    [spaceId, name, parentId],
  );
  return rows[0] ?? null;
};

export const getFolderAncestors = async (
  folderId: number,
): Promise<SpaceFolder[]> => {
  const { rows } = await pool.query<SpaceFolder>(
    `WITH RECURSIVE ancestors AS (
       SELECT * FROM space_folders WHERE id = $1
       UNION ALL
       SELECT f.* FROM space_folders f
       JOIN ancestors a ON f.id = a.parent_id
     )
     SELECT * FROM ancestors WHERE id <> $1`,
    [folderId],
  );
  return rows.reverse();
};

export const isFolderDescendantOf = async ({
  folderId,
  possibleAncestorId,
}: {
  folderId: number;
  possibleAncestorId: number;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `WITH RECURSIVE descendants AS (
       SELECT id
       FROM space_folders
       WHERE parent_id = $1 AND deleted = false
       UNION ALL
       SELECT f.id
       FROM space_folders f
       JOIN descendants d ON f.parent_id = d.id
       WHERE f.deleted = false
     )
     SELECT 1 FROM descendants WHERE id = $2`,
    [possibleAncestorId, folderId],
  );
  return (rowCount ?? 0) > 0;
};

export const moveFolder = async ({
  spaceId,
  folderId,
  parentId,
}: {
  spaceId: number;
  folderId: number;
  parentId: number | null;
}): Promise<SpaceFolder | null> => {
  const { rows } = await pool.query<SpaceFolder>(
    `UPDATE space_folders
     SET parent_id = $3
     WHERE id = $1
       AND space_id = $2
       AND deleted = false
     RETURNING *`,
    [folderId, spaceId, parentId],
  );
  return rows[0] ?? null;
};

export const softDeleteFolderSubtree = async ({
  spaceId,
  folderId,
}: {
  spaceId: number;
  folderId: number;
}): Promise<{ folderCount: number; itemCount: number }> => {
  const { rows } = await pool.query<{ folder_count: number; item_count: number }>(
    `WITH RECURSIVE subtree AS (
       SELECT id
       FROM space_folders
       WHERE id = $2 AND space_id = $1 AND deleted = false
       UNION ALL
       SELECT f.id
       FROM space_folders f
       JOIN subtree s ON f.parent_id = s.id
       WHERE f.space_id = $1 AND f.deleted = false
     ),
     trashed_items AS (
       UPDATE space_items
       SET trashed_at = NOW()
       WHERE space_id = $1
         AND folder_id IN (SELECT id FROM subtree)
         AND deleted = false
         AND trashed_at IS NULL
       RETURNING photo_id
     ),
     deleted_folders AS (
       UPDATE space_folders
       SET deleted = true,
           trashed_at = CASE WHEN id = $2 THEN NOW() ELSE trashed_at END
       WHERE space_id = $1
         AND id IN (SELECT id FROM subtree)
         AND deleted = false
       RETURNING id
     )
     SELECT
       (SELECT COUNT(*)::int FROM deleted_folders) AS folder_count,
       (SELECT COUNT(*)::int FROM trashed_items) AS item_count`,
    [spaceId, folderId],
  );
  return {
    folderCount: rows[0]?.folder_count ?? 0,
    itemCount: rows[0]?.item_count ?? 0,
  };
};

export const getTrashedFolders = async ({
  spaceId,
}: {
  spaceId: number;
}): Promise<Array<{ id: number; name: string; trashed_at: Date; expires_at: Date }>> => {
  const { rows } = await pool.query(
    `SELECT id, name, trashed_at,
            trashed_at + INTERVAL '7 days' AS expires_at
     FROM space_folders
     WHERE space_id = $1
       AND deleted = true
       AND trashed_at IS NOT NULL
       AND trashed_at > NOW() - INTERVAL '7 days'
     ORDER BY trashed_at DESC`,
    [spaceId],
  );
  return rows;
};

export const restoreFolderSubtree = async ({
  spaceId,
  folderId,
}: {
  spaceId: number;
  folderId: number;
}): Promise<{ folderCount: number; itemCount: number }> => {
  const { rows } = await pool.query<{ folder_count: number; item_count: number }>(
    `WITH RECURSIVE subtree AS (
       SELECT id
       FROM space_folders
       WHERE id = $2 AND space_id = $1 AND deleted = true
       UNION ALL
       SELECT f.id
       FROM space_folders f
       JOIN subtree s ON f.parent_id = s.id
       WHERE f.space_id = $1 AND f.deleted = true
     ),
     restored_folders AS (
       UPDATE space_folders
       SET deleted = false, trashed_at = NULL
       WHERE space_id = $1 AND id IN (SELECT id FROM subtree)
       RETURNING id
     ),
     restored_items AS (
       UPDATE space_items
       SET trashed_at = NULL
       WHERE space_id = $1
         AND folder_id IN (SELECT id FROM subtree)
         AND deleted = false
         AND trashed_at IS NOT NULL
       RETURNING photo_id
     )
     SELECT
       (SELECT COUNT(*)::int FROM restored_folders) AS folder_count,
       (SELECT COUNT(*)::int FROM restored_items) AS item_count`,
    [spaceId, folderId],
  );
  return {
    folderCount: rows[0]?.folder_count ?? 0,
    itemCount: rows[0]?.item_count ?? 0,
  };
};

export const permanentlyDeleteTrashedFolder = async ({
  spaceId,
  folderId,
}: {
  spaceId: number;
  folderId: number;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM space_folders
       WHERE id = $2 AND space_id = $1 AND deleted = true AND trashed_at IS NOT NULL
       UNION ALL
       SELECT f.id FROM space_folders f
       JOIN subtree s ON f.parent_id = s.id
       WHERE f.space_id = $1 AND f.deleted = true
     )
     UPDATE space_items
     SET deleted = true
     WHERE space_id = $1
       AND folder_id IN (SELECT id FROM subtree)
       AND deleted = false`,
    [spaceId, folderId],
  );
  // Clear trashed_at so it no longer appears in trash (already deleted=true)
  await pool.query(
    `UPDATE space_folders SET trashed_at = NULL WHERE id = $2 AND space_id = $1`,
    [spaceId, folderId],
  );
  return (rowCount ?? 0) >= 0;
};

export const getTrashedFolderItems = async ({
  spaceId,
  folderId,
}: {
  spaceId: number;
  folderId: number;
}): Promise<import('../types').SpaceItem[]> => {
  const { rows } = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM space_folders
       WHERE id = $2 AND space_id = $1 AND deleted = true
       UNION ALL
       SELECT f.id FROM space_folders f
       JOIN subtree s ON f.parent_id = s.id
       WHERE f.space_id = $1 AND f.deleted = true
     )
     SELECT si.*
     FROM space_items si
     JOIN subtree s ON si.folder_id = s.id
     WHERE si.space_id = $1 AND si.deleted = false AND si.trashed_at IS NOT NULL
     ORDER BY si.trashed_at DESC`,
    [spaceId, folderId],
  );
  return rows;
};

export const getFolderSubtreePaths = async ({
  spaceId,
  folderIds,
}: {
  spaceId: number;
  folderIds: number[];
}): Promise<Array<{ id: number; folder_path: string }>> => {
  if (folderIds.length === 0) return [];
  const { rows } = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id, name, parent_id, name::text AS folder_path
       FROM space_folders
       WHERE id = ANY($2::int[]) AND space_id = $1 AND deleted = false
       UNION ALL
       SELECT f.id, f.name, f.parent_id,
              subtree.folder_path || '/' || f.name
       FROM space_folders f
       JOIN subtree ON f.parent_id = subtree.id
       WHERE f.space_id = $1 AND f.deleted = false
     )
     SELECT id, folder_path FROM subtree`,
    [spaceId, folderIds],
  );
  return rows as Array<{ id: number; folder_path: string }>;
};

export const getTrashedFolderDirectChildren = async ({
  spaceId,
  folderId,
}: {
  spaceId: number;
  folderId: number;
}): Promise<{
  items: import('../types').SpaceItem[];
  subfolders: Array<{ id: number; name: string }>;
}> => {
  const [{ rows: itemRows }, { rows: folderRows }] = await Promise.all([
    pool.query(
      `SELECT * FROM space_items
       WHERE space_id = $1 AND folder_id = $2 AND deleted = false AND trashed_at IS NOT NULL
       ORDER BY uploaded_at DESC`,
      [spaceId, folderId],
    ),
    pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM space_folders
       WHERE space_id = $1 AND parent_id = $2 AND deleted = true
       ORDER BY name ASC`,
      [spaceId, folderId],
    ),
  ]);
  return {
    items: itemRows as import('../types').SpaceItem[],
    subfolders: folderRows,
  };
};

export const prepareRestoreFolder = async ({
  folderId,
  name,
  parentId,
}: {
  folderId: number;
  name: string;
  parentId: number | null;
}): Promise<void> => {
  await pool.query(
    `UPDATE space_folders SET name = $1, parent_id = $2 WHERE id = $3`,
    [name, parentId, folderId],
  );
};

export const getFolderSubtreeItems = async ({
  spaceId,
  folderIds,
}: {
  spaceId: number;
  folderIds: number[];
}): Promise<Array<{ photo_id: string; file_path: string; display_name: string; folder_path: string }>> => {
  if (folderIds.length === 0) return [];
  const { rows } = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id, name, parent_id, name::text AS folder_path
       FROM space_folders
       WHERE id = ANY($2::int[]) AND space_id = $1 AND deleted = false
       UNION ALL
       SELECT f.id, f.name, f.parent_id,
              subtree.folder_path || '/' || f.name
       FROM space_folders f
       JOIN subtree ON f.parent_id = subtree.id
       WHERE f.space_id = $1 AND f.deleted = false
     )
     SELECT i.photo_id, i.file_path, i.display_name, s.folder_path
     FROM space_items i
     JOIN subtree s ON i.folder_id = s.id
     WHERE i.space_id = $1 AND i.deleted = false AND i.trashed_at IS NULL`,
    [spaceId, folderIds],
  );
  return rows;
};
