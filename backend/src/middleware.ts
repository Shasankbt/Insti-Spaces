import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getUserInSpace } from './db';
import type { JwtPayload } from './types';

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header) {
    res.status(401).json({ error: 'No token' });
    return;
  }

  const token = header.split(' ')[1]; // "Bearer <token>"
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const isMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const spaceId = Number(req.params.spaceId);
  if (!Number.isFinite(spaceId)) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const member = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this space' });
    return;
  }

  req.member = member; // { userid, spaceid, role }
  next();
};

export const deltaSync = (req: Request, res: Response, next: NextFunction): void => {
  const since = req.query.since as string | undefined;

  const sinceDate = since ? new Date(since) : new Date(0); // epoch if not given

  if (isNaN(sinceDate.getTime())) {
    res.status(400).json({ error: 'Invalid since timestamp' });
    return;
  }

  // Do not offset by +1ms. JS Date drops microseconds, and adding 1ms can skip rows.
  req.since = sinceDate;
  next();
};

import multer, { StorageEngine } from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { UPLOAD } from './config';

const UPLOADS_ROOT = process.env.UPLOADS_ROOT ?? './uploads';

const storage: StorageEngine = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dest = path.join(UPLOADS_ROOT, 'spaces', String(req.params.spaceId), 'originals');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
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
