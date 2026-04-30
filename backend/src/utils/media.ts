import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { UPLOAD } from '../config';
import { addSpaceItem } from '../db/spaceItems';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

export const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');
export const isImageMime = (mimeType: string): boolean => mimeType.startsWith('image/');
export const isMediaMime = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType.startsWith('video/');

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

export const detectMimeFromMagicBytes = (bytes: Uint8Array): string | null => {
  if (bytes.length < 12) return null;

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return 'image/tiff';
  }
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'].includes(brand)) {
      return brand === 'avif' ? 'image/avif' : 'image/heic';
    }
    return 'video/mp4';
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  return null;
};

export const generateVideoThumbnail = ({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf', `thumbnail,scale=${UPLOAD.THUMB_PX}:-1`, '-frames:v', '1'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

export const generateImagePerceptualHash = async (inputPath: string): Promise<string | null> => {
  try {
    const { data } = await sharp(inputPath)
      .rotate()
      .resize(8, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = [...data];
    const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
    let bits = '';
    for (const value of pixels) {
      bits += value >= average ? '1' : '0';
    }
    let hash = '';
    for (let i = 0; i < bits.length; i += 4) {
      hash += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hash;
  } catch {
    return null;
  }
};

export const applyMp4Faststart = async (inputPath: string): Promise<void> => {
  const tmpPath = `${inputPath}.faststart.tmp`;
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-movflags', '+faststart', '-c', 'copy'])
      .output(tmpPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
  await fs.rename(tmpPath, inputPath);
};

export const commitStoredMediaFile = async ({
  inputPath,
  storageFilename,
  spaceId,
  folderId,
  displayName,
  contentHash,
  uploaderId,
  sizeBytes,
  mimeType,
}: {
  inputPath: string;
  storageFilename: string;
  spaceId: number;
  folderId: number | null;
  displayName: string;
  contentHash: string | null;
  uploaderId: number;
  sizeBytes: number;
  mimeType: string;
}) => {
  const uploadsRoot = path.resolve(UPLOADS_ROOT);
  const originalsDir = path.join(uploadsRoot, 'spaces', String(spaceId), 'originals');
  const thumbnailDirAbs = path.join(uploadsRoot, 'spaces', String(spaceId), 'thumbnails');
  await fs.mkdir(originalsDir, { recursive: true });
  await fs.mkdir(thumbnailDirAbs, { recursive: true });

  const finalOriginalAbsPath = path.join(originalsDir, storageFilename);
  if (path.resolve(inputPath) !== finalOriginalAbsPath) {
    try {
      await fs.rename(inputPath, finalOriginalAbsPath);
    } catch {
      await fs.copyFile(inputPath, finalOriginalAbsPath);
      await fs.unlink(inputPath);
    }
  }

  const filePath = path.join('spaces', String(spaceId), 'originals', storageFilename);
  const thumbnailExt = isVideoMime(mimeType) ? '.jpg' : '.webp';
  const thumbnailFilename = `${path.parse(storageFilename).name}${thumbnailExt}`;
  const thumbnailPath = path.join('spaces', String(spaceId), 'thumbnails', thumbnailFilename);
  const thumbnailAbsPath = path.join(thumbnailDirAbs, thumbnailFilename);

  let perceptualHash: string | null = null;
  if (isVideoMime(mimeType)) {
    await generateVideoThumbnail({ inputPath: finalOriginalAbsPath, outputPath: thumbnailAbsPath });
    if (mimeType === 'video/mp4') {
      await applyMp4Faststart(finalOriginalAbsPath);
    }
  } else {
    perceptualHash = await generateImagePerceptualHash(finalOriginalAbsPath);
    await sharp(finalOriginalAbsPath)
      .resize(UPLOAD.THUMB_PX, UPLOAD.THUMB_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: UPLOAD.THUMB_QUALITY })
      .toFile(thumbnailAbsPath);
  }

  return addSpaceItem({
    spaceId,
    uploaderId,
    folderId,
    filePath,
    thumbnailPath,
    contentHash,
    perceptualHash,
    mimeType,
    sizeBytes,
    displayName,
    capturedAt: null,
  });
};

export const toMediaUrl = (spaceId: number, storagePath: string): string => {
  const kind = path.basename(path.dirname(storagePath));
  const filename = path.basename(storagePath);
  return `/spaces/${spaceId}/media/${kind}/${encodeURIComponent(filename)}`;
};
