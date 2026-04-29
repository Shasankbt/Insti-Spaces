process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth';
import friendsRouter from './routes/friends';
import userRouter from './routes/user';
import spacesRouter from './routes/spaces';
import { RATE } from './config';
import { Request, Response, NextFunction } from 'express';

const app = express();

app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://10.2.192.69:5173'
  ],
  exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length'],
}));

app.use(rateLimit({
  windowMs: RATE.GLOBAL_WINDOW_MS,
  limit: RATE.GLOBAL_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.use('/auth/login', rateLimit({
  windowMs: RATE.LOGIN_WINDOW_MS,
  limit: RATE.LOGIN_MAX,
  message: { error: 'Too many login attempts, try again in 15 minutes' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.use('/auth/register', rateLimit({
  windowMs: RATE.REGISTER_WINDOW_MS,
  limit: RATE.REGISTER_MAX,
  message: { error: 'Too many registrations from this IP' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.use('/auth', authRouter);
app.use('/friends', friendsRouter);
app.use('/user', userRouter);
app.use('/spaces', spacesRouter);

// After your route handlers, in app.ts or wherever you mount routes
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Upload Error]', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  res.status(500).json({ error: err.message ?? 'Upload failed' });
});

export default app;
