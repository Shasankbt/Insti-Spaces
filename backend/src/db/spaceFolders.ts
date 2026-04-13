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
