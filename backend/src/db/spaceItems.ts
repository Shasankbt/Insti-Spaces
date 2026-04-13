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
