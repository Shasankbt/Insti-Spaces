const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middleware');
const {
  getUserInSpace,
  findUserByUsername,
  getSpaceOwnerUserId,
  getSpaceAdminCount,
  changeUserRole,
  getPendingRoleRequest,
  createRoleRequest,
  deleteRoleRequest,
  transferSpaceOwnership,
} = require('../db');
const {
  roleRank,
  HttpError,
  parseSpaceId,
  withTransaction,
  requireSpaceAdmin,
  requireSpaceOwner,
  handleError,
} = require('./spacesHelpers');

// Validates caller is admin and the role request exists and is still pending.
// Must be called inside a transaction.
async function resolveRoleRequest(client, spaceId, requestId, userId) {
  await requireSpaceAdmin(client, spaceId, userId);

  const { rows } = await client.query(
    `SELECT id, user_id, space_id, role, status, created_at, expires_at
     FROM role_requests
     WHERE id = $1 AND space_id = $2
     FOR UPDATE`,
    [requestId, spaceId]
  );
  if (!rows.length) throw new HttpError(404, 'Role request not found');

  const rr = rows[0];
  if (rr.status !== 'pending') throw new HttpError(409, 'Role request is not pending');
  if (rr.expires_at && new Date(rr.expires_at).getTime() <= Date.now()) {
    throw new HttpError(409, 'Role request expired');
  }
  return rr;
}

// POST /spaces/:spaceId/changeRole — change a member's role (admin only)
router.post('/changeRole', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const { username, role } = req.body;
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  const cleanRole = String(role || '').trim();
  if (!roleRank[cleanRole]) return res.status(400).json({ error: 'Invalid role' });

  try {
    const found = await findUserByUsername(username.trim());
    if (!found) return res.status(404).json({ error: 'User not found' });

    const member = await withTransaction(async (client) => {
      // Lock all memberships for this space to avoid races (role changes vs last-admin guards).
      await client.query(`SELECT userid FROM following WHERE spaceid = $1 FOR UPDATE`, [spaceId]);

      await requireSpaceAdmin(client, spaceId, req.user.id);
      const ownerUserId = await getSpaceOwnerUserId(spaceId, client);

      const { rows: targetRows } = await client.query(
        `SELECT role FROM following WHERE spaceid = $1 AND userid = $2`,
        [spaceId, found.id]
      );
      if (!targetRows.length) throw new HttpError(404, 'User is not a member of this space');

      const targetCurrentRole = targetRows[0].role;
      const isSelf = found.id === req.user.id;
      const isTargetOwner = ownerUserId === found.id;
      const isActorOwner = ownerUserId === req.user.id;

      if (isTargetOwner && cleanRole !== 'admin') {
        throw new HttpError(403, {
          error: 'cannot_change_owner_role',
          message: 'The main admin role cannot be changed.',
        });
      }

      if (targetCurrentRole === 'admin' && !isSelf && !isTargetOwner && !isActorOwner && cleanRole !== 'admin') {
        throw new HttpError(403, {
          error: 'cannot_demote_other_admin',
          message: 'Only the main admin can change another admin role.',
        });
      }

      if (isSelf && targetCurrentRole === 'admin' && cleanRole !== 'admin') {
        const adminCount = await getSpaceAdminCount(spaceId, client);
        if (adminCount === 1) {
          throw new HttpError(403, {
            error: 'last_admin',
            message: 'You are the only admin. Promote another member before changing your role.',
          });
        }
      }

      const updated = await changeUserRole({ spaceId, userId: found.id, role: cleanRole }, client);
      if (!updated) throw new HttpError(500, 'Failed to update role');

      await client.query(
        `UPDATE role_requests SET deleted = true
         WHERE user_id = $1 AND space_id = $2 AND status = 'pending' AND deleted = false`,
        [found.id, spaceId]
      );

      return { userid: updated.userid, username: found.username, role: updated.role };
    });

    res.json({ member });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /spaces/:spaceId/transferOwnership — transfer main admin ownership to another admin
router.post('/transferOwnership', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const { userId, username } = req.body;
  if (!userId && !username) {
    return res.status(400).json({ error: 'userId or username is required' });
  }

  try {
    const result = await withTransaction(async (client) => {
      await client.query(`SELECT userid FROM following WHERE spaceid = $1 FOR UPDATE`, [spaceId]);

      await requireSpaceOwner(client, spaceId, req.user.id);

      let targetId = userId ? Number(userId) : null;
      if (!targetId && username) {
        const found = await findUserByUsername(username.trim());
        if (!found) throw new HttpError(404, 'User not found');
        targetId = found.id;
      }
      if (!Number.isFinite(targetId)) throw new HttpError(400, 'Invalid target user');
      if (targetId === req.user.id) throw new HttpError(400, 'You already own this space');

      const targetMembership = await getUserInSpace({ spaceId, userId: targetId });
      if (!targetMembership) throw new HttpError(404, 'User is not a member of this space');
      if (targetMembership.role !== 'admin') {
        throw new HttpError(403, {
          error: 'target_not_admin',
          message: 'Ownership can only be transferred to another admin.',
        });
      }

      const updatedSpace = await transferSpaceOwnership({ spaceId, newOwnerUserId: targetId }, client);
      if (!updatedSpace) throw new HttpError(404, 'Space not found');

      return updatedSpace;
    });

    res.json({ space: result });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /spaces/:spaceId/requestRole — get caller's pending role request (if any)
router.get('/requestRole', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });

  try {
    const request = await getPendingRoleRequest({ userId: req.user.id, spaceId });
    res.json({ request: request || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /spaces/:spaceId/requestRole — request a role upgrade
router.post('/requestRole', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const requestedRole = String(req.body.role || '').trim();
  if (!['contributor', 'moderator', 'admin'].includes(requestedRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });

  if ((roleRank[requestedRole] ?? 0) <= (roleRank[membership.role] ?? 0)) {
    return res.status(400).json({ error: 'role_not_higher' });
  }

  try {
    const request = await createRoleRequest({ userId: req.user.id, spaceId, role: requestedRole });
    res.status(201).json({ request });
  } catch (err) {
    if (err.statusCode === 409 && err.error === 'pending_request_exists') {
      return res.status(409).json({ error: 'pending_request_exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /spaces/:spaceId/requestRole — cancel caller's pending role request
router.delete('/requestRole', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) return res.status(400).json({ error: 'Invalid spaceId' });

  const membership = await getUserInSpace({ spaceId, userId: req.user.id });
  if (!membership) return res.status(403).json({ error: 'Not a member of this space' });

  try {
    const deleted = await deleteRoleRequest({ userId: req.user.id, spaceId });
    if (!deleted) return res.status(404).json({ error: 'No pending request to cancel' });
    res.json({ message: 'Request cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /spaces/:spaceId/roleRequests/:requestId/accept — admin accepts role request
router.post('/roleRequests/:requestId/accept', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const requestId = Number(req.params.requestId);
  if (!spaceId || !Number.isFinite(requestId)) {
    return res.status(400).json({ error: 'Invalid spaceId or requestId' });
  }

  try {
    const result = await withTransaction(async (client) => {
      // Lock memberships first to avoid deadlock with changeRole.
      await client.query(`SELECT userid FROM following WHERE spaceid = $1 FOR UPDATE`, [spaceId]);

      const rr = await resolveRoleRequest(client, spaceId, requestId, req.user.id);

      const updatedMember = await changeUserRole({ spaceId, userId: rr.user_id, role: rr.role }, client);
      if (!updatedMember) throw new HttpError(404, 'User is not a member of this space');

      const { rows } = await client.query(
        `UPDATE role_requests SET status = 'accepted', deleted = true
         WHERE id = $1
         RETURNING id, user_id, space_id, role, status, created_at, expires_at`,
        [requestId]
      );
      return { request: rows[0], member: updatedMember };
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /spaces/:spaceId/roleRequests/:requestId/reject — admin rejects role request
router.post('/roleRequests/:requestId/reject', authenticate, async (req, res) => {
  const spaceId = parseSpaceId(req);
  const requestId = Number(req.params.requestId);
  if (!spaceId || !Number.isFinite(requestId)) {
    return res.status(400).json({ error: 'Invalid spaceId or requestId' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const rr = await resolveRoleRequest(client, spaceId, requestId, req.user.id);

      const { rows } = await client.query(
        `UPDATE role_requests SET status = 'rejected', deleted = true
         WHERE id = $1
         RETURNING id, user_id, space_id, role, status, created_at, expires_at`,
        [rr.id]
      );
      return { request: rows[0] };
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
