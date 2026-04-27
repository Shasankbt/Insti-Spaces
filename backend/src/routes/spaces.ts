import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { authenticate, deltaSync } from '../middleware';
import {
  pool,
  getUserInSpace,
  addUserToSpace,
  findUserByUsername,
  generateInviteLink,
  fetchInviteLink,
  markLinkInviteUsed,
  getSpaceMemberCount,
  removeUserFromSpace,
} from '../db';
import { HttpError, parseSpaceId, withTransaction, requireSpaceRole, handleError } from './spacesHelpers';
import { canInviteAs, canRemoveRole } from '../spacePermissions';
import type { Role } from '../types';
import { validateSpacename } from '../validation';

import spaceViewRouter from './spaceView';
import spaceRolesRouter from './spaceRoles';
import spaceItemsRouter from './spaceItems';
import spaceFoldersRouter from './spaceFolders';

const router = express.Router();

// ── sub-routers ───────────────────────────────────────────────────────────────

router.use('/:spaceId', spaceViewRouter);
router.use('/:spaceId', spaceRolesRouter);
router.use('/:spaceId', spaceItemsRouter);
router.use('/:spaceId', spaceFoldersRouter);

// ── space lifecycle ───────────────────────────────────────────────────────────

// GET /spaces — list spaces the authenticated user follows
router.get('/', authenticate, deltaSync, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.spacename, f.role, f.updated_at
       FROM following f
       JOIN spaces s ON s.id = f.spaceid
       WHERE f.userid = $1 AND f.deleted = false AND f.updated_at > $2
       ORDER BY s.spacename ASC`,
      [req.user.id, req.since],
    );
    res.json({ spaces: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /spaces/create — create a space and auto-follow creator as admin
router.post('/create', authenticate, async (req, res) => {
  const parsed = validateSpacename((req.body as { spacename?: unknown }).spacename);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  const spacename = parsed.data;

  try {
    const space = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number; spacename: string; created_at: Date }>(
        `INSERT INTO spaces (spacename, owner_user_id) VALUES ($1, $2) RETURNING id, spacename, created_at`,
        [spacename, req.user.id],
      );
      await client.query(
        `INSERT INTO following (userid, spaceid, role) VALUES ($1, $2, 'admin')`,
        [req.user.id, rows[0].id],
      );
      return rows[0];
    });
    res.status(201).json({ space });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') return res.status(409).json({ error: 'Space name already taken' });
    handleError(res, err);
  }
});

// POST /spaces/join-via-link — join a space via invite link
router.post('/join-via-link', authenticate, async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }

  try {
    const invite = await fetchInviteLink(token);
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invite link' });

    const { rows: spaceRows } = await pool.query<{ spacename: string }>(
      `SELECT spacename FROM spaces WHERE id = $1`,
      [invite.space_id],
    );
    const spaceName = spaceRows[0]?.spacename;
    if (!spaceName) return res.status(404).json({ error: 'Space not found' });

    const existing = await getUserInSpace({ spaceId: invite.space_id, userId: req.user.id });
    if (existing) return res.json({ spaceId: invite.space_id, spaceName, alreadyMember: true });

    const inserted = await addUserToSpace({ userId: req.user.id, spaceId: invite.space_id, role: invite.role });
    if (!inserted) return res.json({ spaceId: invite.space_id, spaceName, alreadyMember: true });

    await markLinkInviteUsed(token);

    res.json({ spaceId: invite.space_id, spaceName, joined: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /spaces/:spaceId/leave — leave a space
router.delete('/:spaceId/leave', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  try {
    const result = await withTransaction(async (client) => {
      await client.query(`SELECT userid FROM following WHERE spaceid = $1 FOR UPDATE`, [spaceId]);

      const { rows } = await client.query<{ role: Role }>(
        `SELECT role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
        [spaceId, req.user.id],
      );
      if (!rows.length) throw new HttpError(404, 'You are not a member of this space');

      const leavingRole = rows[0].role;

      if (leavingRole === 'admin') {
        const memberCount = await getSpaceMemberCount(spaceId, client);
        if (memberCount === 1) {
          await client.query(`DELETE FROM following WHERE spaceid = $1 AND userid = $2`, [spaceId, req.user.id]);
          await client.query(`DELETE FROM spaces WHERE id = $1`, [spaceId]);
          return { message: 'Left space', spaceDeleted: true };
        }
        throw new HttpError(403, {
          error: 'admin_cannot_leave',
          message: 'Admins cannot leave while other members exist.',
        });
      }

      await client.query(`UPDATE following SET deleted = true WHERE spaceid = $1 AND userid = $2`, [spaceId, req.user.id]);
      return { message: 'Left space' };
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /spaces/:spaceId — delete a space (admin only)
router.delete('/:spaceId', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });
  if ((req.body as { confirm?: boolean })?.confirm !== true) {
    return res.status(400).json({ error: 'Confirmation required' });
  }

  let photoUrls: string[] = [];

  try {
    await withTransaction(async (client) => {
      const { rows: spaceRows } = await client.query(
        `SELECT id FROM spaces WHERE id = $1 FOR UPDATE`,
        [spaceId],
      );
      if (!spaceRows.length) throw new HttpError(404, 'Space not found');

      await requireSpaceRole(client, spaceId, req.user.id, ['admin']);

      const { rows: postRows } = await client.query<{ photo_url: string | null }>(
        `SELECT photo_url FROM space_posts WHERE spaceid = $1`,
        [spaceId],
      );
      photoUrls = postRows.map((r) => r.photo_url).filter((u): u is string => u !== null);

      await client.query(`DELETE FROM following WHERE spaceid = $1`, [spaceId]);
      await client.query(`DELETE FROM spaces WHERE id = $1`, [spaceId]);
    });

    const uploadsDir = path.join(__dirname, '../../uploads');
    await Promise.all(
      photoUrls.map(async (url) => {
        try {
          const filename = path.basename(String(url));
          if (!filename) return;
          await fs.unlink(path.join(uploadsDir, filename));
        } catch (e: unknown) {
          const fsErr = e as { code?: string };
          if (fsErr?.code !== 'ENOENT') console.warn('Failed to delete photo file for space delete:', e);
        }
      }),
    );

    res.json({ message: 'Space deleted' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /spaces/:spaceId/invite — directly add a user to the space
router.post('/:spaceId/invite', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const { userId, username, role = 'viewer' } = req.body as {
    userId?: number;
    username?: string;
    role?: Role;
  };

  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });
  if (!userId && !username) return res.status(400).json({ error: 'userId or username is required' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });

  if (!canInviteAs(membership.role, role)) {
    return res.status(403).json({ error: 'You do not have permission to invite with that role' });
  }

  try {
    let targetId: number | null = userId ? Number(userId) : null;
    if (!targetId && username) {
      const found = await findUserByUsername(username.trim());
      if (!found) return res.status(404).json({ error: 'User not found' });
      targetId = found.id;
    }
    if (!targetId) return res.status(400).json({ error: 'Could not resolve target user' });

    const inserted = await addUserToSpace({ spaceId, userId: targetId, role });
    if (!inserted) return res.status(409).json({ error: 'User is already a member of this space' });
    res.json({ message: 'User invited' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /spaces/:spaceId/generate-invite-link
router.get('/:spaceId/generate-invite-link', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });
  if (!(['admin', 'moderator'] as Role[]).includes(membership.role)) {
    return res.status(403).json({ error: 'Only admins and moderators can generate invite links' });
  }

  const token = await generateInviteLink(spaceId, 'viewer');
  res.json({ inviteLink: `http://localhost:5173/spaces/join?token=${token}` });
});

// DELETE /spaces/:spaceId/members/:userId — remove a member
router.delete('/:spaceId/members/:userId', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const targetUserId = Number(req.params.userId);
  if (!spaceId || !Number.isFinite(targetUserId)) {
    return res.status(400).json({ error: 'Invalid spaceId or userId' });
  }

  try {
    await withTransaction(async (client) => {
      await client.query(`SELECT userid FROM following WHERE spaceid = $1 FOR UPDATE`, [spaceId]);

      const callerRole = await requireSpaceRole(client, spaceId, req.user.id, ['admin', 'moderator']);

      const { rows: targetRows } = await client.query<{ role: Role }>(
        `SELECT role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
        [spaceId, targetUserId],
      );
      if (!targetRows.length) throw new HttpError(404, 'User is not a member of this space');

      const targetRole = targetRows[0].role;
      if (!canRemoveRole(callerRole, targetRole)) {
        throw new HttpError(403, 'You do not have permission to remove this member');
      }

      const removed = await removeUserFromSpace({ spaceId, userId: targetUserId }, client);
      if (!removed) throw new HttpError(404, 'User is not a member of this space');

      await client.query(
        `UPDATE role_requests SET deleted = true
         WHERE user_id = $1 AND space_id = $2 AND status = 'pending' AND deleted = false`,
        [targetUserId, spaceId],
      );
    });
    res.json({ message: 'Member removed' });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
