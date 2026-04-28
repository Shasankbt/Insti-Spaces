import pool from './pool';
import type { SpaceItem } from '../types';
import { PAGE, TRASH } from '../config';

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

export const getDisplayNamesInFolder = async ({
  spaceId,
  folderId,
}: {
  spaceId: number;
  folderId: number | null;
}): Promise<string[]> => {
  const { rows } = await pool.query<{ display_name: string }>(
    `SELECT display_name
     FROM space_items
     WHERE space_id = $1
       AND deleted = false
       AND trashed_at IS NULL
       AND folder_id IS NOT DISTINCT FROM $2`,
    [spaceId, folderId],
  );
  return rows.map((row) => row.display_name);
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

export const getItemsInFolderPage = async ({
  spaceId,
  folderId,
  limit = PAGE.ITEMS_DEFAULT,
  cursor = null,
}: {
  spaceId: number;
  folderId: number | null;
  limit?: number;
  cursor?: { at: string; id: string } | null;
}): Promise<{ rows: SpaceItem[]; nextCursor: { at: string; id: string } | null }> => {
  const cap = Math.min(Math.max(limit, 1), PAGE.ITEMS_MAX);
  const fetch = cap + 1;
  let rows: SpaceItem[];

  if (cursor) {
    const { rows: r } = await pool.query<SpaceItem>(
      `SELECT * FROM space_items
       WHERE space_id = $1
         AND folder_id IS NOT DISTINCT FROM $2
         AND deleted = false
         AND trashed_at IS NULL
         AND (uploaded_at < $3 OR (uploaded_at = $3 AND photo_id::text < $4))
       ORDER BY uploaded_at DESC, photo_id DESC
       LIMIT $5`,
      [spaceId, folderId, cursor.at, cursor.id, fetch],
    );
    rows = r;
  } else {
    const { rows: r } = await pool.query<SpaceItem>(
      `SELECT * FROM space_items
       WHERE space_id = $1
         AND folder_id IS NOT DISTINCT FROM $2
         AND deleted = false
         AND trashed_at IS NULL
       ORDER BY uploaded_at DESC, photo_id DESC
       LIMIT $3`,
      [spaceId, folderId, fetch],
    );
    rows = r;
  }

  const hasMore = rows.length > cap;
  const page = hasMore ? rows.slice(0, cap) : rows;
  if (!hasMore || page.length === 0) return { rows: page, nextCursor: null };
  const last = page[page.length - 1];
  return { rows: page, nextCursor: { at: last.uploaded_at.toISOString(), id: last.photo_id } };
};

export const getItemsInFolderSince = async ({
  spaceId,
  folderId,
  since,
}: {
  spaceId: number;
  folderId: number | null;
  since: Date;
}): Promise<SpaceItem[]> => {
  const { rows } = await pool.query<SpaceItem>(
    `SELECT * FROM space_items
     WHERE space_id = $1
       AND folder_id IS NOT DISTINCT FROM $2
       AND updated_at > $3
     ORDER BY uploaded_at DESC`,
    [spaceId, folderId, since],
  );
  return rows;
};

export const getTrashedItems = async ({
  spaceId,
  limit = PAGE.TRASH_DEFAULT,
  offset = 0,
}: {
  spaceId: number;
  limit?: number;
  offset?: number;
}): Promise<{ rows: SpaceItem[]; hasMore: boolean }> => {
  const cap = Math.min(Math.max(limit, 1), PAGE.TRASH_MAX);
  const { rows } = await pool.query<SpaceItem>(
    `SELECT * FROM space_items
     WHERE space_id = $1
       AND deleted = false
       AND trashed_at IS NOT NULL
     ORDER BY trashed_at DESC
     LIMIT $2 OFFSET $3`,
    [spaceId, cap + 1, offset],
  );
  const hasMore = rows.length > cap;
  return { rows: hasMore ? rows.slice(0, cap) : rows, hasMore };
};

export const getItemsByIds = async ({
  spaceId,
  itemIds,
}: {
  spaceId: number;
  itemIds: string[];
}): Promise<SpaceItem[]> => {
  if (itemIds.length === 0) return [];
  const { rows } = await pool.query<SpaceItem>(
    `SELECT * FROM space_items
     WHERE space_id = $1 AND deleted = false AND trashed_at IS NULL
       AND photo_id = ANY($2::uuid[])`,
    [spaceId, itemIds],
  );
  return rows;
};

export const getItemById = async ({
  spaceId,
  itemId,
}: {
  spaceId: number;
  itemId: string;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `SELECT * FROM space_items
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NULL
     LIMIT 1`,
    [spaceId, itemId],
  );
  return rows[0] ?? null;
};

export const getItemByMediaPath = async ({
  spaceId,
  mediaPath,
}: {
  spaceId: number;
  mediaPath: string;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `SELECT * FROM space_items
     WHERE space_id = $1
       AND deleted = false
       AND (file_path = $2 OR thumbnail_path = $2)
     LIMIT 1`,
    [spaceId, mediaPath],
  );
  return rows[0] ?? null;
};

export const moveSpaceItemToTrash = async ({
  spaceId,
  itemId,
}: {
  spaceId: number;
  itemId: string;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET trashed_at = NOW()
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NULL
     RETURNING *`,
    [spaceId, itemId],
  );
  return rows[0] ?? null;
};

export const restoreSpaceItemFromTrash = async ({
  spaceId,
  itemId,
}: {
  spaceId: number;
  itemId: string;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET trashed_at = NULL
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NOT NULL
     RETURNING *`,
    [spaceId, itemId],
  );
  return rows[0] ?? null;
};

export const renameSpaceItem = async ({
  spaceId,
  itemId,
  displayName,
}: {
  spaceId: number;
  itemId: string;
  displayName: string;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET display_name = $3
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NULL
     RETURNING *`,
    [spaceId, itemId, displayName],
  );
  return rows[0] ?? null;
};

export const moveSpaceItem = async ({
  spaceId,
  itemId,
  folderId,
}: {
  spaceId: number;
  itemId: string;
  folderId: number | null;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET folder_id = $3
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NULL
     RETURNING *`,
    [spaceId, itemId, folderId],
  );
  return rows[0] ?? null;
};

export const bulkMoveSpaceItemsToTrash = async ({
  spaceId,
  itemIds,
}: {
  spaceId: number;
  itemIds: string[];
}): Promise<SpaceItem[]> => {
  if (itemIds.length === 0) return [];
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET trashed_at = NOW()
     WHERE space_id = $1
       AND photo_id = ANY($2::uuid[])
       AND deleted = false
       AND trashed_at IS NULL
     RETURNING *`,
    [spaceId, itemIds],
  );
  return rows;
};

export const bulkMoveSpaceItems = async ({
  spaceId,
  itemIds,
  folderId,
}: {
  spaceId: number;
  itemIds: string[];
  folderId: number | null;
}): Promise<SpaceItem[]> => {
  if (itemIds.length === 0) return [];
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET folder_id = $3
     WHERE space_id = $1
       AND photo_id = ANY($2::uuid[])
       AND deleted = false
       AND trashed_at IS NULL
     RETURNING *`,
    [spaceId, itemIds, folderId],
  );
  return rows;
};

export const getConflictingDisplayNames = async ({
  spaceId,
  folderId,
  candidateNames,
}: {
  spaceId: number;
  folderId: number | null;
  candidateNames: string[];
}): Promise<string[]> => {
  const existing = await getDisplayNamesInFolder({ spaceId, folderId });
  const existingSet = new Set(existing);
  return candidateNames.filter((n) => existingSet.has(n));
};

export const getItemByDisplayNameInFolder = async ({
  spaceId,
  folderId,
  displayName,
}: {
  spaceId: number;
  folderId: number | null;
  displayName: string;
}): Promise<string | null> => {
  const { rows } = await pool.query<{ photo_id: string }>(
    `SELECT photo_id
     FROM space_items
     WHERE space_id = $1
       AND folder_id IS NOT DISTINCT FROM $2
       AND display_name = $3
       AND deleted = false
       AND trashed_at IS NULL
     LIMIT 1`,
    [spaceId, folderId, displayName],
  );
  return rows[0]?.photo_id ?? null;
};

export const softDeleteSpaceItem = async ({
  spaceId,
  itemId,
}: {
  spaceId: number;
  itemId: string;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `UPDATE space_items
     SET deleted = true
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false`,
    [spaceId, itemId],
  );
  return (rowCount ?? 0) > 0;
};

export const moveAndRenameSpaceItem = async ({
  spaceId,
  itemId,
  folderId,
  displayName,
}: {
  spaceId: number;
  itemId: string;
  folderId: number | null;
  displayName: string;
}): Promise<SpaceItem | null> => {
  const { rows } = await pool.query<SpaceItem>(
    `UPDATE space_items
     SET folder_id = $3, display_name = $4
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NULL
     RETURNING *`,
    [spaceId, itemId, folderId, displayName],
  );
  return rows[0] ?? null;
};

export const permanentlyDeleteTrashedSpaceItem = async ({
  spaceId,
  itemId,
}: {
  spaceId: number;
  itemId: string;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `UPDATE space_items
     SET deleted = true
     WHERE space_id = $1
       AND photo_id = $2::uuid
       AND deleted = false
       AND trashed_at IS NOT NULL
     RETURNING photo_id`,
    [spaceId, itemId],
  );
  return (rowCount ?? 0) > 0;
};

export const emptySpaceTrash = async ({
  spaceId,
}: {
  spaceId: number;
}): Promise<number> => {
  const { rowCount } = await pool.query(
    `UPDATE space_items
     SET deleted = true
     WHERE space_id = $1
       AND deleted = false
       AND trashed_at IS NOT NULL`,
    [spaceId],
  );
  return rowCount ?? 0;
};

export const purgeExpiredTrash = async (): Promise<number> => {
  const { rowCount } = await pool.query(
    `UPDATE space_items
     SET deleted = true
     WHERE deleted = false
       AND trashed_at IS NOT NULL
       AND trashed_at <= NOW() - (${TRASH.EXPIRY_DAYS} * INTERVAL '1 day')`,
  );
  return rowCount ?? 0;
};

export const purgeExpiredSpaceTrash = async ({
  spaceId,
}: {
  spaceId: number;
}): Promise<number> => {
  const { rowCount } = await pool.query(
    `UPDATE space_items
     SET deleted = true
     WHERE space_id = $1
       AND deleted = false
       AND trashed_at IS NOT NULL
       AND trashed_at <= NOW() - (${TRASH.EXPIRY_DAYS} * INTERVAL '1 day')`,
    [spaceId],
  );
  return rowCount ?? 0;
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
