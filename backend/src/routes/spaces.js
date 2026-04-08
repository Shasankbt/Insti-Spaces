const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const { authenticate, deltaSync } = require('../middleware');
const {
  pool,
  getUserInSpace,
  addUserToSpace,
  findUserByUsername,
  generateInviteLink,
  fetchInviteLink,
  markLinkInviteUsed,
  getSpaceAdminCount,
  getSpaceMemberCount,
} = require('../db');
const { HttpError, parseSpaceId, withTransaction, requireSpaceAdmin, handleError } = require('./spacesHelpers');

// ── sub-routers ───────────────────────────────────────────────────────────────

router.use('/:spaceId', require('./spaceView'));
router.use('/:spaceId', require('./spaceRoles'));
router.use('/:spaceId', require('./spaceContent'));

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
      [req.user.id, req.since]
    );
    res.json({ spaces: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /spaces/create — create a space and auto-follow as admin
router.post('/create', authenticate, async (req, res) => {
  const { spacename } = req.body;
  if (!spacename || !spacename.trim()) {
    return res.status(400).json({ error: 'spacename is required' });
  }

  try {
    const space = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO spaces (spacename) VALUES ($1) RETURNING id, spacename, created_at`,
        [spacename.trim()]
      );
      await client.query(
        `INSERT INTO following (userid, spaceid, role) VALUES ($1, $2, 'admin')`,
        [req.user.id, rows[0].id]
      );
      return rows[0];
    });
    res.status(201).json({ space });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Space name already taken' });
    handleError(res, err);
  }
});

// POST /spaces/join-via-link — join a space via invite link
router.post('/join-via-link', authenticate, async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }

  try {
    const invite = await fetchInviteLink(token);
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invite link' });

    const { rows: spaceRows } = await pool.query(
      `SELECT spacename FROM spaces WHERE id = $1`,
      [invite.space_id]
    );
    const spaceName = spaceRows[0]?.spacename;
    if (!spaceName) return res.status(404).json({ error: 'Space not found' });

    const existing = await getUserInSpace({ spaceId: invite.space_id, userId: req.user.id });
    if (existing) return res.json({ spaceId: invite.space_id, spaceName, alreadyMember: true });

    const inserted = await addUserToSpace({ userId: req.user.id, spaceId: invite.space_id, role: invite.role });
    if (!inserted) return res.json({ spaceId: invite.space_id, spaceName, alreadyMember: true });

    await markLinkInviteUsed(token);

    res.json({ spaceId: invite.space_id, spaceName, joined: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /spaces/:spaceId/leave — leave a space
router.delete('/:spaceId/leave', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  try {
    const result = await withTransaction(async (client) => {
      // Lock all memberships for this space to prevent races (e.g., two admins leaving at once).
      await client.query(`SELECT userid FROM following WHERE spaceid = $1 FOR UPDATE`, [spaceId]);

      const { rows } = await client.query(
        `SELECT role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
        [spaceId, req.user.id]
      );
      if (!rows.length) throw new HttpError(404, 'You are not a member of this space');

      const leavingRole = rows[0].role;
      const adminCount = await getSpaceAdminCount(spaceId, client);

      if (leavingRole === 'admin' && adminCount === 1) {
        const memberCount = await getSpaceMemberCount(spaceId, client);
        if (memberCount === 1) {
          await client.query(`DELETE FROM following WHERE spaceid = $1 AND userid = $2`, [spaceId, req.user.id]);
          await client.query(`DELETE FROM spaces WHERE id = $1`, [spaceId]);
          return { message: 'Left space', spaceDeleted: true };
        }
        throw new HttpError(403, {
          error: 'last_admin',
          message: 'You are the only admin. Promote another member before leaving.',
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
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmation required' });

  let photoUrls = [];

  try {
    await withTransaction(async (client) => {
      const { rows: spaceRows } = await client.query(
        `SELECT id FROM spaces WHERE id = $1 FOR UPDATE`,
        [spaceId]
      );
      if (!spaceRows.length) throw new HttpError(404, 'Space not found');

      await requireSpaceAdmin(client, spaceId, req.user.id);

      const { rows: postRows } = await client.query(
        `SELECT photo_url FROM space_posts WHERE spaceid = $1`,
        [spaceId]
      );
      photoUrls = postRows.map((r) => r.photo_url).filter(Boolean);

      // `following.spaceid` does not have ON DELETE CASCADE in the current schema,
      // so we must delete memberships explicitly before deleting the space.
      await client.query(`DELETE FROM following WHERE spaceid = $1`, [spaceId]);
      await client.query(`DELETE FROM spaces WHERE id = $1`, [spaceId]);
    });

    // Best-effort cleanup of uploaded files after the DB transaction commits.
    const uploadsDir = path.join(__dirname, '../../uploads');
    await Promise.all(
      photoUrls.map(async (url) => {
        try {
          const filename = path.basename(String(url));
          if (!filename) return;
          await fs.unlink(path.join(uploadsDir, filename));
        } catch (e) {
          if (e?.code !== 'ENOENT') console.warn('Failed to delete photo file for space delete:', e);
        }
      })
    );

    res.json({ message: 'Space deleted' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /spaces/:spaceId/invite — directly add a user to the space (admin only)
router.post('/:spaceId/invite', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const { userId, username } = req.body;

  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });
  if (!userId && !username) return res.status(400).json({ error: 'userId or username is required' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });
  if (membership.role !== 'admin') return res.status(403).json({ error: 'Only admins can invite' });

  try {
    let targetId = userId ? Number(userId) : null;
    if (!targetId && username) {
      const found = await findUserByUsername(username.trim());
      if (!found) return res.status(404).json({ error: 'User not found' });
      targetId = found.id;
    }
    const inserted = await addUserToSpace({ spaceId, userId: targetId });
    if (!inserted) return res.status(409).json({ error: 'User is already a member of this space' });
    res.json({ message: 'User invited' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /spaces/:spaceId/generate-invite-link — generate a signed invite link (admin only)
router.get('/:spaceId/generate-invite-link', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });
  if (membership.role !== 'admin') return res.status(403).json({ error: 'Only admins can generate invite links' });

  const token = await generateInviteLink(spaceId, 'viewer');
  res.json({ inviteLink: `http://localhost:5173/spaces/join?token=${token}` });
});

module.exports = router;
