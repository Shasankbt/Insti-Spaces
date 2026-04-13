import pool, { withTransaction } from './pool';
import type { FriendRequest, Friend } from '../types';

const apiError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

export const areFriends = async ({
  userAId,
  userBId,
}: {
  userAId: number;
  userBId: number;
}): Promise<boolean> => {
  const { rows } = await pool.query(
    `SELECT 1 FROM friends
     WHERE fid = LEAST($1, $2) AND sid = GREATEST($1, $2) LIMIT 1`,
    [userAId, userBId],
  );
  return rows.length > 0;
};

export const createFriendRequest = async ({
  fromUserId,
  toUserId,
}: {
  fromUserId: number;
  toUserId: number;
}): Promise<FriendRequest> => {
  if (fromUserId === toUserId)
    throw apiError('Cannot send friend request to yourself', 400);

  if (await areFriends({ userAId: fromUserId, userBId: toUserId }))
    throw apiError('You are already friends', 409);

  const { rows: existing } = await pool.query(
    `SELECT id FROM friend_requests
     WHERE status = 'pending'
       AND ((from_user_id = $1 AND to_user_id = $2)
         OR (from_user_id = $2 AND to_user_id = $1))
     LIMIT 1`,
    [fromUserId, toUserId],
  );
  if (existing.length) throw apiError('A pending friend request already exists', 409);

  const { rows } = await pool.query<FriendRequest>(
    `INSERT INTO friend_requests (from_user_id, to_user_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id, from_user_id, to_user_id, status, created_at`,
    [fromUserId, toUserId],
  );
  return rows[0];
};

export const acceptFriendRequest = async ({
  requestId,
  userId,
}: {
  requestId: number;
  userId: number;
}): Promise<FriendRequest> =>
  withTransaction(async (client) => {
    const { rows } = await client.query<FriendRequest>(
      `SELECT id, from_user_id, to_user_id, status
       FROM friend_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!rows.length) throw apiError('Friend request not found', 404);

    const fr = rows[0];
    if (fr.to_user_id !== userId) throw apiError('Not allowed', 403);
    if (fr.status !== 'pending') throw apiError('Friend request is not pending', 409);

    const { rows: updated } = await client.query<FriendRequest>(
      `UPDATE friend_requests
       SET status = 'accepted', responded_at = NOW()
       WHERE id = $1
       RETURNING id, from_user_id, to_user_id, status, created_at, responded_at`,
      [requestId],
    );

    await client.query(
      `INSERT INTO friends (fid, sid)
       VALUES (LEAST($1, $2), GREATEST($1, $2)) ON CONFLICT DO NOTHING`,
      [updated[0].from_user_id, updated[0].to_user_id],
    );

    return updated[0];
  });

export const listFriends = async ({
  userId,
  limit = 200,
  since = new Date(0),
}: {
  userId: number;
  limit?: number;
  since?: Date;
}): Promise<Friend[]> => {
  const finalLimit = Math.min(Math.max(limit, 1), 500);
  const { rows } = await pool.query<Friend>(
    `SELECT u.id, u.username, fr.responded_at AS updated_at
     FROM friends f
     JOIN users u ON u.id = CASE WHEN f.fid = $1 THEN f.sid ELSE f.fid END
     JOIN friend_requests fr ON fr.status = 'accepted'
       AND ((fr.from_user_id = $1 AND fr.to_user_id = u.id)
         OR (fr.from_user_id = u.id AND fr.to_user_id = $1))
     WHERE (f.fid = $1 OR f.sid = $1) AND fr.responded_at > $3
     ORDER BY u.username ASC
     LIMIT $2`,
    [userId, finalLimit, since],
  );
  return rows;
};

export const listNotifications = async ({
  userId,
  limit = 50,
  since = new Date(0),
}: {
  userId: number;
  limit?: number;
  since?: Date;
}): Promise<unknown[]> => {
  const finalLimit = Math.min(Math.max(limit, 1), 200);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT
         fr.id,
         ('friend_request:' || fr.id::text) AS uid,
         'friend_request'::text  AS type,
         fr.from_user_id, fr.to_user_id, fr.status,
         COALESCE(fr.responded_at, fr.created_at) AS created_at,
         fr.responded_at,
         u_from.username AS from_username,
         u_to.username   AS to_username,
         NULL::int       AS space_id,
         NULL::text      AS spacename,
         NULL::text      AS requested_role,
         false::boolean  AS deleted
       FROM friend_requests fr
       JOIN users u_from ON u_from.id = fr.from_user_id
       JOIN users u_to   ON u_to.id   = fr.to_user_id
       WHERE ((fr.to_user_id = $1 AND fr.status = 'pending')
          OR ((fr.to_user_id = $1 OR fr.from_user_id = $1) AND fr.status = 'accepted'))
         AND COALESCE(fr.responded_at, fr.created_at) > $3

       UNION ALL

       SELECT
         rr.id,
         ('role_request:' || rr.id::text) AS uid,
         'role_request'::text   AS type,
         rr.user_id             AS from_user_id,
         NULL::int              AS to_user_id,
         rr.status,
         rr.updated_at          AS created_at,
         NULL::timestamptz      AS responded_at,
         u_req.username         AS from_username,
         NULL::text             AS to_username,
         rr.space_id, s.spacename,
         rr.role                AS requested_role,
         rr.deleted
       FROM role_requests rr
       JOIN users  u_req ON u_req.id = rr.user_id
       JOIN spaces s     ON s.id     = rr.space_id
       JOIN following f  ON f.spaceid = rr.space_id
                        AND f.userid = $1
                        AND f.role IN ('admin', 'moderator')
       WHERE (rr.expires_at IS NULL OR rr.expires_at > NOW())
         AND rr.updated_at > $3
         AND ((rr.status = 'pending' AND rr.deleted = false) OR rr.deleted = true)
     ) n
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, finalLimit, since],
  );
  return rows;
};
