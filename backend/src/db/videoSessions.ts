import fs from 'fs/promises';
import pool from './pool';

export interface VideoUploadSession {
  sessionId: string;
  spaceId: number;
  uploaderId: number;
  folderId: number | null;
  displayName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  totalChunks: number;
  nextChunkIndex: number;
  tempDir: string;
  createdAt: Date;
}

type VideoUploadSessionRow = {
  id: string;
  space_id: number;
  uploader_id: number;
  folder_id: number | null;
  display_name: string;
  original_name: string;
  mime_type: string;
  size_bytes: string | number;
  content_hash: string | null;
  total_chunks: number;
  next_chunk_index: number;
  temp_dir: string;
  created_at: Date;
};

const mapVideoSessionRow = (row: VideoUploadSessionRow): VideoUploadSession => ({
  sessionId: row.id,
  spaceId: row.space_id,
  uploaderId: row.uploader_id,
  folderId: row.folder_id,
  displayName: row.display_name,
  originalName: row.original_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  contentHash: row.content_hash,
  totalChunks: row.total_chunks,
  nextChunkIndex: row.next_chunk_index,
  tempDir: row.temp_dir,
  createdAt: row.created_at,
});

export const createVideoSession = async ({
  sessionId,
  spaceId,
  uploaderId,
  folderId,
  displayName,
  originalName,
  mimeType,
  sizeBytes,
  contentHash,
  totalChunks,
  tempDir,
}: {
  sessionId: string;
  spaceId: number;
  uploaderId: number;
  folderId: number | null;
  displayName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  totalChunks: number;
  tempDir: string;
}): Promise<VideoUploadSession> => {
  const { rows } = await pool.query<VideoUploadSessionRow>(
    `INSERT INTO video_upload_sessions (
       id,
       space_id,
       uploader_id,
       folder_id,
       display_name,
       original_name,
       mime_type,
       size_bytes,
       content_hash,
       total_chunks,
       next_chunk_index,
       temp_dir
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11)
     RETURNING id, space_id, uploader_id, folder_id, display_name, original_name, mime_type, size_bytes, content_hash, total_chunks, next_chunk_index, temp_dir, created_at`,
    [
      sessionId,
      spaceId,
      uploaderId,
      folderId,
      displayName,
      originalName,
      mimeType,
      sizeBytes,
      contentHash,
      totalChunks,
      tempDir,
    ],
  );
  return mapVideoSessionRow(rows[0]);
};

export const getVideoSession = async (id: string): Promise<VideoUploadSession | null> => {
  const { rows } = await pool.query<VideoUploadSessionRow>(
    `SELECT id, space_id, uploader_id, folder_id, display_name, original_name, mime_type, size_bytes, content_hash, total_chunks, next_chunk_index, temp_dir, created_at
     FROM video_upload_sessions
     WHERE id = $1
       AND expires_at > NOW()`,
    [id],
  );
  return rows[0] ? mapVideoSessionRow(rows[0]) : null;
};

export const updateVideoSessionChunk = async (id: string, nextIndex: number): Promise<void> => {
  await pool.query(
    `UPDATE video_upload_sessions
     SET next_chunk_index = $2
     WHERE id = $1
       AND expires_at > NOW()`,
    [id, nextIndex],
  );
};

export const deleteVideoSession = async (id: string): Promise<void> => {
  await pool.query(`DELETE FROM video_upload_sessions WHERE id = $1`, [id]);
};

export const purgeExpiredVideoSessions = async (): Promise<void> => {
  const { rows } = await pool.query<{ temp_dir: string }>(
    `DELETE FROM video_upload_sessions
     WHERE expires_at <= NOW()
     RETURNING temp_dir`,
  );

  await Promise.all(
    rows.map(async (row) => {
      try {
        await fs.rm(row.temp_dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }),
  );
};
