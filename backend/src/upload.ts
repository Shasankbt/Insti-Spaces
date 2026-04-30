import multer, { StorageEngine } from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { UPLOAD } from './config';

const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

const storage: StorageEngine = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dest = path.join(UPLOADS_ROOT, 'spaces', String(req.params.spaceId), 'originals');
    console.log('[Multer] Writing to:', dest);
    try {
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      console.error('[Multer] mkdirSync failed:', err);
      cb(err as Error, dest);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: UPLOAD.MAX_FILE_BYTES },
});
