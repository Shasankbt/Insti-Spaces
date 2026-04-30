import path from 'path';
import { mediaPool } from '../workers/mediaPool';
import type { MediaTaskResult } from '../workers/mediaWorker';

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

export const generateVideoThumbnail = async ({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> => {
  await mediaPool.run({ type: 'video-thumbnail', inputPath, outputPath });
};

export const generateImageThumbnail = async ({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> => {
  await mediaPool.run({ type: 'image-thumbnail', inputPath, outputPath });
};

export const generateImagePerceptualHash = async (inputPath: string): Promise<string | null> => {
  const result = (await mediaPool.run({ type: 'image-phash', inputPath })) as Extract<
    MediaTaskResult,
    { type: 'image-phash' }
  >;
  return result.hash;
};

export const applyMp4Faststart = async (inputPath: string): Promise<void> => {
  await mediaPool.run({ type: 'video-faststart', inputPath });
};

export const toMediaUrl = (spaceId: number, storagePath: string): string => {
  const kind = path.basename(path.dirname(storagePath));
  const filename = path.basename(storagePath);
  return `/spaces/${spaceId}/media/${kind}/${encodeURIComponent(filename)}`;
};
