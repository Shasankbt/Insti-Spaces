import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware';
import { pool, getUserInSpace } from '../db';
import { parseSpaceId } from './spacesHelpers';

const router = Router({ mergeParams: true });

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

// POST /spaces/:spaceId/contribute — upload photos to a space
router.post('/contribute', authenticate, upload.array('photos', 10), async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ error: 'Invalid spaceId' });
    return;
  }

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership || !['admin', 'moderator', 'contributor'].includes(membership.role)) {
    res.status(403).json({ error: 'Only admins, moderators, and contributors can post' });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No photos uploaded' });
    return;
  }

  try {
    const inserted = await Promise.all(
      files.map(async (file) => {
        const { rows } = await pool.query<{ id: number; photo_url: string; created_at: Date }>(
          `INSERT INTO space_posts (spaceid, userid, photo_url)
           VALUES ($1, $2, $3) RETURNING id, photo_url, created_at`,
          [spaceId, req.user.id, `/uploads/${file.filename}`],
        );
        return rows[0];
      }),
    );
    res.status(201).json({ posts: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
