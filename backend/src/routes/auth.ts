import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware';
import { createUser, findUserByEmail, findUserById, findUserByUsernameOrEmail } from '../db';
import { AUTH } from '../config';
import { validateLoginBody, validateRegisterBody } from '../validation';

const router = Router();

router.post('/register', async (req, res) => {
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
    res.status(201).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
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
