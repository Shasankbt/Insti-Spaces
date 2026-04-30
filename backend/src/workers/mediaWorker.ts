import fs from 'fs/promises';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { UPLOAD } from '../config';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

export type MediaTask =
  | { type: 'image-thumbnail'; inputPath: string; outputPath: string }
  | { type: 'image-phash'; inputPath: string }
  | { type: 'video-thumbnail'; inputPath: string; outputPath: string }
  | { type: 'video-faststart'; inputPath: string };

export type MediaTaskResult =
  | { type: 'image-thumbnail' }
  | { type: 'image-phash'; hash: string | null }
  | { type: 'video-thumbnail' }
  | { type: 'video-faststart' };

export default async function handleTask(task: MediaTask): Promise<MediaTaskResult> {
  switch (task.type) {
    case 'image-thumbnail':
      await sharp(task.inputPath)
        .resize(UPLOAD.THUMB_PX, UPLOAD.THUMB_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: UPLOAD.THUMB_QUALITY })
        .toFile(task.outputPath);
      return { type: 'image-thumbnail' };

    case 'image-phash': {
      try {
        const { data } = await sharp(task.inputPath)
          .rotate()
          .resize(8, 8, { fit: 'fill' })
          .greyscale()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const pixels = [...data];
        const average = pixels.reduce((s, v) => s + v, 0) / pixels.length;
        let bits = '';
        for (const v of pixels) bits += v >= average ? '1' : '0';
        let hash = '';
        for (let i = 0; i < bits.length; i += 4)
          hash += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
        return { type: 'image-phash', hash };
      } catch {
        return { type: 'image-phash', hash: null };
      }
    }

    case 'video-thumbnail':
      await new Promise<void>((resolve, reject) => {
        ffmpeg(task.inputPath)
          .outputOptions(['-vf', `thumbnail,scale=${UPLOAD.THUMB_PX}:-1`, '-frames:v', '1'])
          .output(task.outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
      return { type: 'video-thumbnail' };

    case 'video-faststart': {
      const tmpPath = `${task.inputPath}.faststart.mp4`;
      await new Promise<void>((resolve, reject) => {
        ffmpeg(task.inputPath)
          .outputOptions(['-movflags', '+faststart', '-c', 'copy', '-f', 'mp4'])
          .output(tmpPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
      await fs.rename(tmpPath, task.inputPath);
      return { type: 'video-faststart' };
    }
  }
}
