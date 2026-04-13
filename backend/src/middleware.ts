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

  req.since = new Date(sinceDate.getTime() + 1);
  next();
};
