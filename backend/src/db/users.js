const pool = require('./pool');

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
  );
  return rows[0] || null;
};

const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT id, username, email, password_hash, created_at FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
};

const findUserByUsername = async (username) => {
  const { rows } = await pool.query(
    `SELECT id, username, email, created_at FROM users WHERE username = $1`,
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
         SELECT 1 FROM friends f
         WHERE f.fid = LEAST(u.id, ($2::int)) AND f.sid = GREATEST(u.id, ($2::int))
       ) AS is_friend,
       EXISTS (
         SELECT 1 FROM friend_requests fr
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

module.exports = { createUser, findUserById, findUserByEmail, findUserByUsername, searchUsers };
