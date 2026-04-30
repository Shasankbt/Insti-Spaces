import express, { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { authenticate, isMember } from '../middleware';
import { canWrite } from './spaceUtils';
import { getFolderById } from '../db/spaceFolders';
import {
  type VideoUploadSession,
  createVideoSession,
  getVideoSession,
  updateVideoSessionChunk,
  deleteVideoSession,
} from '../db/videoSessions';
import { commitStoredMediaFile } from '../utils/media';

const router = Router({ mergeParams: true });
const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';
export const VIDEO_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

// Tracks sessions where a simulated failure has already fired (testing only).
const simulatedSessionIds = new Set<string>();

const getVideoSessionTempDir = (spaceId: number, sessionId: string): string =>
  path.resolve(UPLOADS_ROOT, 'spaces', String(spaceId), 'video-sessions', sessionId);

const getVideoStorageFilename = (sessionId: string, originalName: string): string => {
  const ext = path.extname(originalName).toLowerCase() || '.mp4';
  return `${sessionId}${ext}`;
};

const getVideoChunkPath = (session: VideoUploadSession, chunkIndex: number): string =>
  path.join(session.tempDir, `chunk-${String(chunkIndex).padStart(6, '0')}.part`);

const parseVideoChunkIndex = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const initVideoUploadSession = async ({
  spaceId,
  uploaderId,
  folderId,
  displayName,
  originalName,
  mimeType,
  sizeBytes,
  contentHash,
}: {
  spaceId: number;
  uploaderId: number;
  folderId: number | null;
  displayName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
}): Promise<VideoUploadSession> => {
  const sessionId = randomUUID();
  const totalChunks = Math.max(1, Math.ceil(sizeBytes / VIDEO_CHUNK_SIZE_BYTES));
  const tempDir = getVideoSessionTempDir(spaceId, sessionId);

  await fs.mkdir(tempDir, { recursive: true });

  return createVideoSession({
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
  });
};

const finalizeVideoUploadSession = async (session: VideoUploadSession) => {
  const storageFilename = getVideoStorageFilename(session.sessionId, session.originalName);
  const finalChunkPath = path.join(session.tempDir, 'assembled.tmp');
  const chunkPaths: string[] = [];

  for (let i = 0; i < session.totalChunks; i++) {
    const chunkPath = getVideoChunkPath(session, i);
    chunkPaths.push(chunkPath);
    await fs.appendFile(finalChunkPath, await fs.readFile(chunkPath));
  }

  for (const chunkPath of chunkPaths) {
    try { await fs.unlink(chunkPath); } catch { /* best-effort */ }
  }

  const item = await commitStoredMediaFile({
    inputPath: finalChunkPath,
    storageFilename,
    spaceId: session.spaceId,
    folderId: session.folderId,
    displayName: session.displayName,
    contentHash: session.contentHash,
    uploaderId: session.uploaderId,
    sizeBytes: session.sizeBytes,
    mimeType: session.mimeType,
  });

  await deleteVideoSession(session.sessionId);
  try { await fs.rm(session.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

  return item;
};

// POST /spaces/:spaceId/video-sessions
router.post('/video-sessions', authenticate, isMember, express.json(), async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can upload items' });
    return;
  }

  const body = req.body as {
    displayName?: string;
    originalName?: string;
    mimeType?: string;
    sizeBytes?: number;
    contentHash?: string | null;
    folderId?: number | null;
  };

  if (!body.displayName || !body.originalName || !body.mimeType || !Number.isFinite(Number(body.sizeBytes))) {
    res.status(400).json({ error: 'Invalid video session payload' });
    return;
  }

  const spaceId = req.member.spaceid;
  const folderId = body.folderId ?? null;
  if (folderId != null) {
    const folder = await getFolderById(folderId);
    if (!folder || folder.space_id !== spaceId || folder.deleted) {
      res.status(404).json({ error: 'Folder not found in this space' });
      return;
    }
  }

  const session = await initVideoUploadSession({
    spaceId,
    uploaderId: req.user.id,
    folderId,
    displayName: body.displayName,
    originalName: body.originalName,
    mimeType: body.mimeType,
    sizeBytes: Number(body.sizeBytes),
    contentHash: body.contentHash ?? null,
  });

  res.status(201).json({
    sessionId: session.sessionId,
    nextChunkIndex: session.nextChunkIndex,
    totalChunks: session.totalChunks,
    chunkSizeBytes: VIDEO_CHUNK_SIZE_BYTES,
  });
});

// POST /spaces/:spaceId/video-sessions/:sessionId/chunks
router.post(
  '/video-sessions/:sessionId/chunks',
  authenticate,
  isMember,
  express.raw({ type: 'application/octet-stream', limit: `${VIDEO_CHUNK_SIZE_BYTES + 1024 * 1024}b` }),
  async (req, res) => {
    if (!canWrite(req.member.role)) {
      res.status(403).json({ error: 'Only contributors, moderators, and admins can upload items' });
      return;
    }

    const session = await getVideoSession(String(req.params.sessionId));
    if (!session || session.spaceId !== req.member.spaceid) {
      res.status(404).json({ error: 'Video upload session not found' });
      return;
    }

    const chunkIndex = parseVideoChunkIndex(req.header('x-chunk-index'));
    if (chunkIndex == null) {
      res.status(400).json({ error: 'Invalid chunk index' });
      return;
    }

    if (chunkIndex !== session.nextChunkIndex) {
      res.status(409).json({
        error: 'Resume from the next missing chunk',
        nextChunkIndex: session.nextChunkIndex,
        totalChunks: session.totalChunks,
      });
      return;
    }

    const chunk = req.body as Buffer | undefined;
    if (!chunk || chunk.length === 0) {
      res.status(400).json({ error: 'Empty chunk payload' });
      return;
    }

    // Simulation: fail once on chunk 1 for videos with >= 2 chunks (> 8 MB)
    if (session.totalChunks >= 2 && chunkIndex === 1 && !simulatedSessionIds.has(session.sessionId)) {
      simulatedSessionIds.add(session.sessionId);
      console.log(`[video-sim] Simulating failure for session ${session.sessionId} at chunk ${chunkIndex}`);
      res.status(409).json({
        recoverable: true,
        error: `Simulated server interruption at chunk ${chunkIndex} — resume to continue`,
        sessionId: session.sessionId,
        nextChunkIndex: session.nextChunkIndex,
        totalChunks: session.totalChunks,
      });
      return;
    }

    await fs.writeFile(getVideoChunkPath(session, chunkIndex), chunk);
    const newNextChunkIndex = chunkIndex + 1;
    await updateVideoSessionChunk(session.sessionId, newNextChunkIndex);

    res.status(200).json({
      sessionId: session.sessionId,
      nextChunkIndex: newNextChunkIndex,
      totalChunks: session.totalChunks,
      complete: newNextChunkIndex >= session.totalChunks,
    });
  },
);

// POST /spaces/:spaceId/video-sessions/:sessionId/complete
router.post('/video-sessions/:sessionId/complete', authenticate, isMember, express.json(), async (req, res) => {
  if (!canWrite(req.member.role)) {
    res.status(403).json({ error: 'Only contributors, moderators, and admins can upload items' });
    return;
  }

  const session = await getVideoSession(String(req.params.sessionId));
  if (!session || session.spaceId !== req.member.spaceid) {
    res.status(404).json({ error: 'Video upload session not found' });
    return;
  }

  if (session.nextChunkIndex < session.totalChunks) {
    res.status(409).json({
      error: 'Upload incomplete',
      nextChunkIndex: session.nextChunkIndex,
      totalChunks: session.totalChunks,
    });
    return;
  }

  try {
    const item = await finalizeVideoUploadSession(session);
    res.status(201).json({ item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
