import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { randomUUID, createHash } from 'crypto';
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { VideoUploadSession } from '../db/videoSessions';
import type { SpaceItem } from '../types';
import { addSpaceItem } from '../db/spaceItems';
import { deleteVideoSession } from '../db/videoSessions';
import {
  isVideoMime,
  isHeicMime,
  generateVideoThumbnail,
  generateImageThumbnail,
  generateImagePerceptualHash,
  applyMp4Faststart,
  transcodeHeicToJpeg,
} from '../utils/media';

/**
 * Stream-hash a file with SHA-256. Used as a server-side fallback when the
 * client didn't supply a content_hash — most commonly when the browser is
 * on plain HTTP and `crypto.subtle` is unavailable. Without this fallback
 * the duplicates feature finds nothing because rows store NULL content_hash.
 */
async function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
    stream.on('error', reject);
  });
}

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

    let originalRel = path.join(originalsRel, storageFilename);
    await this.storage.save(inputPath, originalRel);
    let originalAbsPath = this.storage.resolveAbsolute(originalRel);
    let resolvedMime = mimeType;
    let resolvedSize = sizeBytes;
    let resolvedDisplayName = displayName;

    // HEIC isn't decodable by sharp on most builds and only Safari can render
    // it. Transcode to JPEG once, in place, and pretend the rest of the
    // pipeline only ever saw a JPEG.
    if (isHeicMime(mimeType)) {
      try {
        const jpegAbsPath = await transcodeHeicToJpeg(originalAbsPath);
        originalAbsPath = jpegAbsPath;
        originalRel = path.join(originalsRel, path.basename(jpegAbsPath));
        resolvedMime = 'image/jpeg';
        const stat = await fs.stat(jpegAbsPath);
        resolvedSize = stat.size;
        // Swap the user-visible extension to match the new format.
        const dnExt = path.extname(displayName);
        if (dnExt && /^\.(heic|heif)$/i.test(dnExt)) {
          resolvedDisplayName = `${path.basename(displayName, dnExt)}.jpg`;
        }
      } catch (err) {
        // Hard fail — better to surface than to commit a row whose original
        // can't be rendered or thumbnailed.
        throw new Error(`HEIC transcode failed: ${(err as Error).message}`);
      }
    }

    const finalStem = path.parse(originalRel).name;
    const thumbnailExt = isVideoMime(resolvedMime) ? '.jpg' : '.webp';
    const thumbnailFilename = `${finalStem}${thumbnailExt}`;
    const thumbnailRel = path.join(thumbnailsRel, thumbnailFilename);
    const thumbnailAbsPath = this.storage.resolveAbsolute(thumbnailRel);

    let perceptualHash: string | null = null;
    if (isVideoMime(resolvedMime)) {
      await generateVideoThumbnail({ inputPath: originalAbsPath, outputPath: thumbnailAbsPath });
      if (resolvedMime === 'video/mp4') {
        try {
          await applyMp4Faststart(originalAbsPath);
        } catch (err) {
          console.warn('[faststart] skipped — file will still play:', (err as Error).message);
        }
      }
    } else {
      perceptualHash = await generateImagePerceptualHash(originalAbsPath);
      await generateImageThumbnail({ inputPath: originalAbsPath, outputPath: thumbnailAbsPath });
    }

    let resolvedContentHash = contentHash;
    if (resolvedContentHash == null) {
      try {
        resolvedContentHash = await hashFileSha256(originalAbsPath);
      } catch {
        // Non-fatal — leave NULL; the row simply won't participate in dedup.
      }
    }

    return addSpaceItem({
      spaceId,
      uploaderId,
      folderId,
      filePath: originalRel,
      thumbnailPath: thumbnailRel,
      contentHash: resolvedContentHash,
      perceptualHash,
      mimeType: resolvedMime,
      sizeBytes: resolvedSize,
      displayName: resolvedDisplayName,
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
      // A copy is byte-identical to the source — preserve the hash so the
      // duplicates view continues to group source + copy together.
      contentHash: sourceItem.content_hash ?? null,
      perceptualHash: sourceItem.perceptual_hash,
      mimeType: sourceItem.mime_type,
      sizeBytes: sourceItem.size_bytes,
      displayName,
      capturedAt: null,
    });
  }
}
