import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { VideoUploadSession } from '../db/videoSessions';
import type { SpaceItem } from '../types';
import { addSpaceItem } from '../db/spaceItems';
import { deleteVideoSession } from '../db/videoSessions';
import {
  isVideoMime,
  generateVideoThumbnail,
  generateImageThumbnail,
  generateImagePerceptualHash,
  applyMp4Faststart,
} from '../utils/media';

interface CommitFileParams {
  inputPath: string;
  storageFilename: string;
  spaceId: number;
  folderId: number | null;
  displayName: string;
  contentHash: string | null;
  uploaderId: number;
  sizeBytes: number;
  mimeType: string;
}

interface CopyItemParams {
  sourceItem: SpaceItem;
  spaceId: number;
  uploaderId: number;
  folderId: number | null;
  displayName: string;
}

export class SpaceItemService {
  constructor(private readonly storage: StorageAdapter) {}

  async commitFile({
    inputPath,
    storageFilename,
    spaceId,
    folderId,
    displayName,
    contentHash,
    uploaderId,
    sizeBytes,
    mimeType,
  }: CommitFileParams): Promise<SpaceItem> {
    const originalsRel = path.join('spaces', String(spaceId), 'originals');
    const thumbnailsRel = path.join('spaces', String(spaceId), 'thumbnails');
    await Promise.all([
      this.storage.ensureDir(originalsRel),
      this.storage.ensureDir(thumbnailsRel),
    ]);

    const originalRel = path.join(originalsRel, storageFilename);
    await this.storage.save(inputPath, originalRel);
    const originalAbsPath = this.storage.resolveAbsolute(originalRel);

    const thumbnailExt = isVideoMime(mimeType) ? '.jpg' : '.webp';
    const thumbnailFilename = `${path.parse(storageFilename).name}${thumbnailExt}`;
    const thumbnailRel = path.join(thumbnailsRel, thumbnailFilename);
    const thumbnailAbsPath = this.storage.resolveAbsolute(thumbnailRel);

    let perceptualHash: string | null = null;
    if (isVideoMime(mimeType)) {
      await generateVideoThumbnail({ inputPath: originalAbsPath, outputPath: thumbnailAbsPath });
      if (mimeType === 'video/mp4') await applyMp4Faststart(originalAbsPath);
    } else {
      perceptualHash = await generateImagePerceptualHash(originalAbsPath);
      await generateImageThumbnail({ inputPath: originalAbsPath, outputPath: thumbnailAbsPath });
    }

    return addSpaceItem({
      spaceId,
      uploaderId,
      folderId,
      filePath: originalRel,
      thumbnailPath: thumbnailRel,
      contentHash,
      perceptualHash,
      mimeType,
      sizeBytes,
      displayName,
      capturedAt: null,
    });
  }

  async finalizeVideoSession(session: VideoUploadSession): Promise<SpaceItem> {
    const ext = path.extname(session.originalName).toLowerCase() || '.mp4';
    const storageFilename = `${session.sessionId}${ext}`;
    const finalChunkPath = path.join(session.tempDir, 'assembled.tmp');
    const chunkPaths: string[] = [];

    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(session.tempDir, `chunk-${String(i).padStart(6, '0')}.part`);
      chunkPaths.push(chunkPath);
      await fs.appendFile(finalChunkPath, await fs.readFile(chunkPath));
    }
    for (const chunkPath of chunkPaths) {
      try { await fs.unlink(chunkPath); } catch { /* best-effort */ }
    }

    const item = await this.commitFile({
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
  }

  async copyItem({
    sourceItem,
    spaceId,
    uploaderId,
    folderId,
    displayName,
  }: CopyItemParams): Promise<SpaceItem> {
    const newId = randomUUID();
    const fileExt = path.extname(sourceItem.file_path);
    const thumbExt = path.extname(sourceItem.thumbnail_path);

    const originalsRel = path.join('spaces', String(spaceId), 'originals');
    const thumbnailsRel = path.join('spaces', String(spaceId), 'thumbnails');
    await Promise.all([
      this.storage.ensureDir(originalsRel),
      this.storage.ensureDir(thumbnailsRel),
    ]);

    const newFileRel = path.join(originalsRel, `${newId}${fileExt}`);
    const newThumbRel = path.join(thumbnailsRel, `${newId}${thumbExt}`);
    await Promise.all([
      this.storage.copyFile(sourceItem.file_path, newFileRel),
      this.storage.copyFile(sourceItem.thumbnail_path, newThumbRel),
    ]);

    return addSpaceItem({
      spaceId,
      uploaderId,
      folderId,
      filePath: newFileRel,
      thumbnailPath: newThumbRel,
      contentHash: null,
      perceptualHash: sourceItem.perceptual_hash,
      mimeType: sourceItem.mime_type,
      sizeBytes: sourceItem.size_bytes,
      displayName,
      capturedAt: null,
    });
  }
}
