import multer, { StorageEngine } from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { UPLOAD } from './config';
import { storage } from './storage';

const diskStorage: StorageEngine = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dest = path.join(storage.root, 'spaces', String(req.params.spaceId), 'originals');
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
  storage: diskStorage,
  limits: { fileSize: UPLOAD.MAX_FILE_BYTES },
});
