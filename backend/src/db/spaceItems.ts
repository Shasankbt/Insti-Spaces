import pool from './pool';
import type { SpaceItem } from '../types';

export const addSpaceItem = async ({
  spaceId,
  uploaderId,
  folderId = null,
  filePath,
  thumbnailPath,
  mimeType,
  sizeBytes,
  displayName,
  capturedAt,
}: {
  spaceId: number;
  uploaderId: number;
  folderId?: number | null;
  filePath: string;
  thumbnailPath: string;
  mimeType: string;
  sizeBytes: number;
  displayName: string;
  capturedAt: Date | null;
}): Promise<SpaceItem> => {
  const { rows } = await pool.query<SpaceItem>(
    `INSERT INTO space_items
       (space_id, uploader_id, folder_id, file_path, thumbnail_path, mime_type, size_bytes, display_name, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [spaceId, uploaderId, folderId, filePath, thumbnailPath, mimeType, sizeBytes, displayName, capturedAt],
  );
  return rows[0];
};

export const getSpaceItemsForPageView = async ({
  spaceId,
  limit,
}: {
  spaceId: number;
  limit?: number;
}): Promise<SpaceItem[]> => {
  const values: Array<number> = [spaceId];
  let query = `SELECT *
               FROM space_items
               WHERE space_id = $1
                 AND deleted = false
                 AND trashed_at IS NULL
               ORDER BY uploaded_at DESC`;

  if (typeof limit === 'number') {
    values.push(limit);
    query += ` LIMIT $2`;
  }

  const { rows } = await pool.query<SpaceItem>(query, values);
  return rows;
};
