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
