import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware';
import { createUser, findUserByEmail, findUserById } from '../db';

const router = Router();

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!username || username === '') return res.status(409).json({ error: 'empty username not allowed' });
  if (!email || email === '') return res.status(409).json({ error: 'empty email not allowed' });
  if (!password || password === '') return res.status(409).json({ error: 'empty password not allowed' });

  try {
    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const hash = await bcrypt.hash(password, 10);
    const user = await createUser(username, email, hash);
    res.status(201).json({ user });
  } catch {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  try {
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' },
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  const user = await findUserById(req.user.id);
  res.json({ user });
});

export default router;
