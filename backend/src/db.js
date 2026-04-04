const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});


const createUser = async (username, email, passwordHash) => {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id, username, email`,
    [username, email, passwordHash]
  );
  return rows[0];
};

const findUserById = async (id) => {
  const { rows } = await pool.query(
    `SELECT id, username, email FROM users WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
};

const findUserByUsername = async (username) => {
  const { rows } = await pool.query(
    `SELECT id, username, email, created_at
     FROM users
     WHERE username = $1`,
    [username]
  );
  return rows[0] || null;
};

const searchUsers = async ({ prefix, excludeUserId, limit = 20 }) => {
  const cleanPrefix = (prefix || '').trim();
  if (!cleanPrefix) return [];

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.username,
       EXISTS (
         SELECT 1
         FROM friends f
         WHERE f.fid = LEAST(u.id, ($2::int)) AND f.sid = GREATEST(u.id, ($2::int))
       ) AS is_friend,
       EXISTS (
         SELECT 1
         FROM friend_requests fr
         WHERE fr.status = 'pending'
           AND ((fr.from_user_id = ($2::int) AND fr.to_user_id = u.id)
             OR (fr.from_user_id = u.id AND fr.to_user_id = ($2::int)))
       ) AS has_pending_request
     FROM users u
     WHERE u.username ILIKE $1 || '%'
       AND u.id <> ($2::int)
     ORDER BY u.username ASC
     LIMIT $3`,
    [cleanPrefix, excludeUserId, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    relationship: r.is_friend ? 'friends' : (r.has_pending_request ? 'pending' : 'none'),
  }));
};

const areFriends = async ({ userAId, userBId }) => {
  const { rows } = await pool.query(
    `SELECT 1
     FROM friends
     WHERE fid = LEAST(($1::int), ($2::int)) AND sid = GREATEST(($1::int), ($2::int))
     LIMIT 1`,
    [userAId, userBId]
  );
  return rows.length > 0;
};

const createFriendRequest = async ({ fromUserId, toUserId }) => {
  const fromId = Number.parseInt(String(fromUserId), 10);
  const toId = Number.parseInt(String(toUserId), 10);
  if (!Number.isInteger(fromId) || !Number.isInteger(toId)) {
    const err = new Error('Invalid user id');
    err.statusCode = 400;
    throw err;
  }

  if (fromId === toId) {
    const err = new Error('Cannot send friend request to yourself');
    err.statusCode = 400;
    throw err;
  }

  if (await areFriends({ userAId: fromId, userBId: toId })) {
    const err = new Error('You are already friends');
    err.statusCode = 409;
    throw err;
  }

  const { rows: existing } = await pool.query(
    `SELECT id
     FROM friend_requests
     WHERE status = 'pending'
       AND ((from_user_id = ($1::int) AND to_user_id = ($2::int))
         OR (from_user_id = ($2::int) AND to_user_id = ($1::int)))
     LIMIT 1`,
    [fromId, toId]
  );
  if (existing.length) {
    const err = new Error('A pending friend request already exists');
    err.statusCode = 409;
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO friend_requests (from_user_id, to_user_id, status)
     VALUES (($1::int), ($2::int), 'pending')
     RETURNING id, from_user_id, to_user_id, status, created_at`,
    [fromId, toId]
  );
  return rows[0];
};

const listFriendRequests = async ({ userId, limit = 50 }) => {
  const { rows } = await pool.query(
    `SELECT
       fr.id,
       fr.from_user_id,
       fr.to_user_id,
       fr.status,
       fr.created_at,
       fr.responded_at,
       u_from.username AS from_username,
       u_to.username AS to_username
     FROM friend_requests fr
     JOIN users u_from ON u_from.id = fr.from_user_id
     JOIN users u_to   ON u_to.id   = fr.to_user_id
     WHERE
       (fr.to_user_id = ($1::int) AND fr.status = 'pending')
       OR ((fr.to_user_id = ($1::int) OR fr.from_user_id = ($1::int)) AND fr.status = 'accepted')
     ORDER BY COALESCE(fr.responded_at, fr.created_at) DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
};

const acceptFriendRequest = async ({ requestId, userId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: requests } = await client.query(
      `SELECT id, from_user_id, to_user_id, status
       FROM friend_requests
       WHERE id = ($1::int)
       FOR UPDATE`,
      [requestId]
    );

    if (!requests.length) {
      const err = new Error('Friend request not found');
      err.statusCode = 404;
      throw err;
    }

    const fr = requests[0];
    if (fr.to_user_id !== userId) {
      const err = new Error('Not allowed');
      err.statusCode = 403;
      throw err;
    }
    if (fr.status !== 'pending') {
      const err = new Error('Friend request is not pending');
      err.statusCode = 409;
      throw err;
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE friend_requests
       SET status = 'accepted', responded_at = NOW()
       WHERE id = ($1::int)
       RETURNING id, from_user_id, to_user_id, status, created_at, responded_at`,
      [requestId]
    );
    const updated = updatedRows[0];

    await client.query(
      `INSERT INTO friends (fid, sid)
       VALUES (LEAST(($1::int), ($2::int)), GREATEST(($1::int), ($2::int)))
       ON CONFLICT DO NOTHING`,
      [updated.from_user_id, updated.to_user_id]
    );

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  createUser,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  searchUsers,
  createFriendRequest,
  listFriendRequests,
  acceptFriendRequest,
};