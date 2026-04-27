import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth';
import friendsRouter from './routes/friends';
import userRouter from './routes/user';
import spacesRouter from './routes/spaces';

const app = express();

app.use(express.json());
app.use(cors({ origin: 'http://localhost:5173' }));

// Broad floor: 200 req/min covers all endpoints
app.use(rateLimit({
  windowMs: 60_000,
  limit: 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

// Auth routes get a tight window — bcrypt at cost=10 is ~100ms/call
app.use('/auth/login', rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  message: { error: 'Too many login attempts, try again in 15 minutes' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.use('/auth/register', rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  message: { error: 'Too many registrations from this IP' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.use('/auth', authRouter);
app.use('/friends', friendsRouter);
app.use('/user', userRouter);
app.use('/spaces', spacesRouter);

export default app;
