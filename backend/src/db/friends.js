const pool = require('./pool');

const areFriends = async ({ userAId, userBId }) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM friends
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
    `SELECT id FROM friend_requests
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

const listFriends = async ({ userId, limit = 200 }) => {
  const id = Number.parseInt(String(userId), 10);
  if (!Number.isInteger(id)) {
    const err = new Error('Invalid user id');
    err.statusCode = 400;
    throw err;
  }

  const cleanLimit = Number.parseInt(String(limit), 10);
  const finalLimit = Number.isInteger(cleanLimit) && cleanLimit > 0 ? Math.min(cleanLimit, 500) : 200;

  const { rows } = await pool.query(
    `SELECT u.id, u.username
     FROM friends f
     JOIN users u ON u.id = CASE WHEN f.fid = ($1::int) THEN f.sid ELSE f.fid END
     WHERE f.fid = ($1::int) OR f.sid = ($1::int)
     ORDER BY u.username ASC
     LIMIT $2`,
    [id, finalLimit]
  );
  return rows;
};

const listNotifications = async ({ userId, limit = 50 }) => {
  const cleanUserId = Number.parseInt(String(userId), 10);
  const cleanLimit = Number.parseInt(String(limit), 10);
  const finalLimit = Number.isInteger(cleanLimit) && cleanLimit > 0 ? Math.min(cleanLimit, 200) : 50;

  const { rows } = await pool.query(
    `SELECT *
     FROM (
       SELECT
         fr.id,
         'friend_request'::text  AS type,
         fr.from_user_id,
         fr.to_user_id,
         fr.status,
         COALESCE(fr.responded_at, fr.created_at) AS created_at,
         fr.responded_at,
         u_from.username         AS from_username,
         u_to.username           AS to_username,
         NULL::int               AS space_id,
         NULL::text              AS spacename,
         NULL::text              AS requested_role
       FROM friend_requests fr
       JOIN users u_from ON u_from.id = fr.from_user_id
       JOIN users u_to   ON u_to.id   = fr.to_user_id
       WHERE (fr.to_user_id = ($1::int) AND fr.status = 'pending')
          OR ((fr.to_user_id = ($1::int) OR fr.from_user_id = ($1::int)) AND fr.status = 'accepted')

       UNION ALL

       SELECT
         rr.id,
         'role_request'::text    AS type,
         rr.user_id              AS from_user_id,
         NULL::int               AS to_user_id,
         rr.status,
         rr.created_at,
         NULL::timestamptz       AS responded_at,
         u_req.username          AS from_username,
         NULL::text              AS to_username,
         rr.space_id,
         s.spacename,
         rr.role                 AS requested_role
       FROM role_requests rr
       JOIN users  u_req ON u_req.id = rr.user_id
       JOIN spaces s     ON s.id     = rr.space_id
       JOIN following f  ON f.spaceid = rr.space_id AND f.userid = ($1::int) AND f.role = 'admin'
       WHERE rr.status = 'pending'
         AND (rr.expires_at IS NULL OR rr.expires_at > NOW())
     ) n
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [cleanUserId, finalLimit]
  );
  return rows;
};

module.exports = { areFriends, createFriendRequest, acceptFriendRequest, listFriends, listNotifications };
