import { Router, RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware';
import { createUser, findUserByEmail, findUserById, findUserByUsernameOrEmail } from '../db';
import { AUTH, RATE, DEBUG } from '../config';
import { validateLoginBody, validateRegisterBody } from '../validation';

const router = Router();

const loginLimiter: RequestHandler = DEBUG
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: RATE.LOGIN_WINDOW_MS,
      limit: RATE.LOGIN_MAX,
      message: { error: 'Too many login attempts, try again in 15 minutes' },
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    });

const registerLimiter: RequestHandler = DEBUG
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: RATE.REGISTER_WINDOW_MS,
      limit: RATE.REGISTER_MAX,
      message: { error: 'Too many registrations from this IP' },
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    });

router.post('/register', registerLimiter, async (req, res) => {
  const parsed = validateRegisterBody(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  const { username, email, password } = parsed.data;

  try {
    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const hash = await bcrypt.hash(password, AUTH.BCRYPT_COST);
    const user = await createUser(username, email, hash);
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: AUTH.JWT_EXPIRY },
    );
    res.status(201).json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const parsed = validateLoginBody(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  const { username, password } = parsed.data;

  try {
    const user = await findUserByUsernameOrEmail(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: AUTH.JWT_EXPIRY },
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  const user = await findUserById(req.user.id);
  res.json({ user });
});

export default router;
