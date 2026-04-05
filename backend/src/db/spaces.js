const pool = require('./pool');

const getUserInSpace = async ({ spaceId, userId }) => {
  const { rows } = await pool.query(
    `SELECT userid, spaceid, role FROM following WHERE spaceid = $1 AND userid = $2`,
    [spaceId, userId]
  );
  return rows[0] || null;
};

const addUserToSpace = async ({ spaceId, userId, role = 'viewer' }) => {
  const { rows } = await pool.query(
    `INSERT INTO following (userid, spaceid, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (userid, spaceid) DO NOTHING
     RETURNING userid, spaceid, role`,
    [userId, spaceId, role]
  );
  return rows[0] || null;
};

const getSpaceById = async ({ spaceId }) => {
  const { rows } = await pool.query(
    `SELECT id, spacename, created_at FROM spaces WHERE id = $1`,
    [spaceId]
  );
  return rows[0] || null;
};

const getSpaceMembers = async (spaceId) => {
  const { rows } = await pool.query(
    `SELECT u.id AS userid, u.username, f.role
     FROM following f
     JOIN users u ON u.id = f.userid
     WHERE f.spaceid = $1`,
    [spaceId]
  );
  return rows;
};

const getSpaceAdminCount = async (spaceId, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanSpaceId)) return 0;

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM following WHERE spaceid = $1 AND role = 'admin'`,
    [cleanSpaceId]
  );
  return rows[0]?.count ?? 0;
};

const getSpaceMemberCount = async (spaceId, client = pool) => {
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanSpaceId)) return 0;

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM following WHERE spaceid = $1`,
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
    // Free up a slot if the only pending request is already expired.
    await client.query(
      `UPDATE role_requests SET status = 'rejected'
       WHERE user_id = $1
         AND space_id = $2
         AND status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()`,
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
    `DELETE FROM role_requests
     WHERE user_id = $1 AND space_id = $2 AND status = 'pending'`,
    [cleanUserId, cleanSpaceId]
  );
  return rowCount;
};

module.exports = {
  getUserInSpace,
  addUserToSpace,
  getSpaceById,
  getSpaceMembers,
  getSpaceAdminCount,
  getSpaceMemberCount,
  changeUserRole,
  getPendingRoleRequest,
  createRoleRequest,
  deleteRoleRequest,
};
