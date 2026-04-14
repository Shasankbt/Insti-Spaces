import pool from './pool';
import type { SpaceItem } from '../types';

export const addSpaceItem = async ({
  spaceId,
  uploaderId,
  folderId = null,
  filePath,
  thumbnailPath,
  contentHash,
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
  contentHash?: string | null;
  mimeType: string;
  sizeBytes: number;
  displayName: string;
  capturedAt: Date | null;
}): Promise<SpaceItem> => {
  const { rows } = await pool.query<SpaceItem>(
    `INSERT INTO space_items
       (space_id, uploader_id, folder_id, file_path, thumbnail_path, content_hash, mime_type, size_bytes, display_name, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [spaceId, uploaderId, folderId, filePath, thumbnailPath, contentHash ?? null, mimeType, sizeBytes, displayName, capturedAt],
  );
  return rows[0];
};

export const getExistingContentHashes = async ({
  spaceId,
  hashes,
}: {
  spaceId: number;
  hashes: string[];
}): Promise<string[]> => {
  if (hashes.length === 0) {
    return [];
  }

  const { rows } = await pool.query<{ content_hash: string }>(
    `SELECT DISTINCT content_hash
     FROM space_items
     WHERE space_id = $1
       AND deleted = false
       AND trashed_at IS NULL
       AND content_hash IS NOT NULL
       AND content_hash = ANY($2::text[])`,
    [spaceId, hashes],
  );

  return rows.map((row) => row.content_hash);
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

export const isLikeableSpaceItemInSpace = async ({
  itemId,
  spaceId,
}: {
  itemId: string;
  spaceId: number;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `SELECT 1
     FROM space_items
     WHERE photo_id = $1
       AND space_id = $2
       AND deleted = false
       AND trashed_at IS NULL`,
    [itemId, spaceId],
  );
  return (rowCount ?? 0) > 0;
};

export const likeSpaceItem = async ({
  itemId,
  userId,
}: {
  itemId: string;
  userId: number;
}): Promise<void> => {
  await pool.query(
    `INSERT INTO space_item_likes (space_item_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (space_item_id, user_id) DO NOTHING`,
    [itemId, userId],
  );
};

export const getLikeSummaryForItems = async ({
  itemIds,
  userId,
}: {
  itemIds: string[];
  userId: number;
}): Promise<Map<string, { likeCount: number; likedByMe: boolean }>> => {
  const summary = new Map<string, { likeCount: number; likedByMe: boolean }>();
  if (itemIds.length === 0) {
    return summary;
  }

  let rows: Array<{
    space_item_id: string;
    like_count: number;
    liked_by_me: boolean;
  }> = [];

  try {
    const result = await pool.query<{
      space_item_id: string;
      like_count: number;
      liked_by_me: boolean;
    }>(
      `SELECT
         l.space_item_id,
         COUNT(*)::int AS like_count,
         COALESCE(BOOL_OR(l.user_id = $2), false) AS liked_by_me
       FROM space_item_likes l
       WHERE l.space_item_id = ANY($1::uuid[])
       GROUP BY l.space_item_id`,
      [itemIds, userId],
    );
    rows = result.rows;
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code !== '42P01') {
      throw err;
    }
    return summary;
  }

  rows.forEach((row) => {
    summary.set(row.space_item_id, {
      likeCount: row.like_count,
      likedByMe: row.liked_by_me,
    });
  });

  return summary;
};
