const pool = require('./pool');

const getUserInSpace = async ({ spaceId, userId }) => {
  const { rows } = await pool.query(
    `SELECT userid, spaceid, role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
    [spaceId, userId]
  );
  return rows[0] || null;
};

const addUserToSpace = async ({ spaceId, userId, role = 'viewer' }) => {
  const { rows } = await pool.query(
    `INSERT INTO following (userid, spaceid, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (userid, spaceid) DO UPDATE
       SET deleted = false, role = EXCLUDED.role
       WHERE following.deleted = true
     RETURNING userid, spaceid, role`,
    [userId, spaceId, role]
  );
  return rows[0] || null;
};

const getSpaceById = async ({ spaceId }) => {
  const { rows } = await pool.query(
    `SELECT id, spacename, owner_user_id, created_at FROM spaces WHERE id = $1`,
    [spaceId]
  );
  return rows[0] || null;
};

const getSpaceMembers = async (spaceId, since = new Date(0)) => {
  const { rows } = await pool.query(
    `SELECT u.id AS id, u.id AS userid, u.username, f.role, f.deleted, f.updated_at,
            (s.owner_user_id = u.id) AS is_owner
     FROM following f
     JOIN users u ON u.id = f.userid
     JOIN spaces s ON s.id = f.spaceid
     WHERE f.spaceid = $1 AND f.updated_at > $2`,
    [spaceId, since]
  );
  return rows;
};

const getSpaceOwnerUserId = async (spaceId, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanSpaceId)) return null;

  const { rows } = await client.query(
    `SELECT owner_user_id FROM spaces WHERE id = $1`,
    [cleanSpaceId]
  );
  return rows[0]?.owner_user_id ?? null;
};

const getSpaceAdminCount = async (spaceId, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanSpaceId)) return 0;

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM following WHERE spaceid = $1 AND role = 'admin' AND deleted = false`,
    [cleanSpaceId]
  );
  return rows[0]?.count ?? 0;
};

const getSpaceMemberCount = async (spaceId, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanSpaceId)) return 0;

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM following WHERE spaceid = $1 AND deleted = false`,
    [cleanSpaceId]
  );
  return rows[0]?.count ?? 0;
};

const changeUserRole = async ({ spaceId, userId, role }, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  const cleanUserId = Number(userId);
  const cleanRole = String(role || '').trim();

  if (!Number.isFinite(cleanSpaceId) || !Number.isFinite(cleanUserId)) return null;

  const { rows } = await client.query(
    `UPDATE following SET role = $1
     WHERE userid = $2 AND spaceid = $3
     RETURNING userid, spaceid, role`,
    [cleanRole, cleanUserId, cleanSpaceId]
  );
  return rows[0] || null;
};

const removeUserFromSpace = async ({ spaceId, userId }, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  const cleanUserId = Number(userId);
  if (!Number.isFinite(cleanSpaceId) || !Number.isFinite(cleanUserId)) return null;

  const { rows } = await client.query(
    `UPDATE following
     SET deleted = true
     WHERE userid = $1 AND spaceid = $2 AND deleted = false
     RETURNING userid, spaceid, role`,
    [cleanUserId, cleanSpaceId]
  );
  return rows[0] || null;
};

const transferSpaceOwnership = async ({ spaceId, newOwnerUserId }, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  const cleanNewOwnerUserId = Number(newOwnerUserId);
  if (!Number.isFinite(cleanSpaceId) || !Number.isFinite(cleanNewOwnerUserId)) return null;

  const { rows } = await client.query(
    `UPDATE spaces
     SET owner_user_id = $1
     WHERE id = $2
     RETURNING id, spacename, owner_user_id, created_at`,
    [cleanNewOwnerUserId, cleanSpaceId]
  );
  return rows[0] || null;
};

const getPendingRoleRequest = async ({ userId, spaceId }, client = pool) => {
  const cleanUserId = Number(userId);
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanUserId) || !Number.isFinite(cleanSpaceId)) return null;

  const { rows } = await client.query(
    `SELECT id, user_id, space_id, role, status, created_at, expires_at
     FROM role_requests
     WHERE user_id = $1
       AND space_id = $2
       AND status = 'pending'
       AND deleted = false
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC
     LIMIT 1`,
    [cleanUserId, cleanSpaceId]
  );
  return rows[0] || null;
};

const createRoleRequest = async ({ userId, spaceId, role }, client = pool) => {
  const cleanUserId = Number(userId);
  const cleanSpaceId = Number(spaceId);
  const cleanRole = String(role || '').trim();

  if (!Number.isFinite(cleanUserId) || !Number.isFinite(cleanSpaceId) || !cleanRole) {
    const err = new Error('Invalid role request');
    err.statusCode = 400;
    throw err;
  }

  try {
    // Free the unique index slot for: (1) expired requests, (2) cancelled (soft-deleted) requests.
    await client.query(
      `UPDATE role_requests SET status = 'rejected'
       WHERE user_id = $1
         AND space_id = $2
         AND status = 'pending'
         AND (deleted = true OR (expires_at IS NOT NULL AND expires_at < NOW()))`,
      [cleanUserId, cleanSpaceId]
    );

    const { rows } = await client.query(
      `INSERT INTO role_requests (user_id, space_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, role, status, created_at, expires_at`,
      [cleanUserId, cleanSpaceId, cleanRole]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('A pending request already exists');
      e.statusCode = 409;
      e.error = 'pending_request_exists';
      throw e;
    }
    throw err;
  }
};

const deleteRoleRequest = async ({ userId, spaceId }, client = pool) => {
  const cleanUserId = Number(userId);
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanUserId) || !Number.isFinite(cleanSpaceId)) return 0;

  const { rowCount } = await client.query(
    `UPDATE role_requests SET deleted = true
     WHERE user_id = $1 AND space_id = $2 AND status = 'pending' AND deleted = false`,
    [cleanUserId, cleanSpaceId]
  );
  return rowCount;
};

module.exports = {
  getUserInSpace,
  addUserToSpace,
  getSpaceById,
  getSpaceMembers,
  getSpaceOwnerUserId,
  getSpaceAdminCount,
  getSpaceMemberCount,
  changeUserRole,
  removeUserFromSpace,
  transferSpaceOwnership,
  getPendingRoleRequest,
  createRoleRequest,
  deleteRoleRequest,
};
