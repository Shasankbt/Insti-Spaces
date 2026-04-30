import { Pool, PoolClient } from 'pg';
import pool from './pool';
import type { Member, Space, Role, RoleRequest, RoleRequestStatus } from '../types';

type DbClient = Pool | PoolClient;

export const getUserInSpace = async ({
  spaceId,
  userId,
}: {
  spaceId: number;
  userId: number;
}): Promise<Member | null> => {
  const { rows } = await pool.query<Member>(
    `SELECT userid, spaceid, role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
    [spaceId, userId],
  );
  return rows[0] ?? null;
};

export const addUserToSpace = async ({
  spaceId,
  userId,
  role = 'viewer',
}: {
  spaceId: number;
  userId: number;
  role?: Role;
}): Promise<Member | null> => {
  const { rows } = await pool.query<Member>(
    `INSERT INTO following (userid, spaceid, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (userid, spaceid) DO UPDATE
       SET deleted = false, role = EXCLUDED.role
       WHERE following.deleted = true
     RETURNING userid, spaceid, role`,
    [userId, spaceId, role],
  );
  return rows[0] ?? null;
};

export const getSpaceById = async ({
  spaceId,
}: {
  spaceId: number;
}): Promise<Space | null> => {
  // Storage size is fetched lazily by `getSpaceStorageBytes` when the About tab
  // is opened — keeping it out of this query avoids a SUM(size_bytes) scan on
  // every page load.
  const { rows } = await pool.query<Space>(
    `SELECT
       s.id,
       s.spacename,
       s.created_at,
       s.owner_user_id,
       owner.username AS owner_username
     FROM spaces s
     LEFT JOIN users owner ON owner.id = s.owner_user_id
     WHERE s.id = $1`,
    [spaceId],
  );
  const row = rows[0];
  if (!row) return null;
  return row;
};

export const getSpaceStorageBytes = async ({ spaceId }: { spaceId: number }): Promise<number> => {
  const { rows } = await pool.query<{ total_storage_bytes: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total_storage_bytes
       FROM space_items
      WHERE space_id = $1
        AND deleted = false
        AND trashed_at IS NULL`,
    [spaceId],
  );
  return Number(rows[0]?.total_storage_bytes ?? 0);
};

export const getSpaceMembers = async (
  spaceId: number,
  since: Date = new Date(0),
): Promise<Array<Member & { username: string; deleted: boolean; updated_at: Date }>> => {
  const { rows } = await pool.query(
    `SELECT u.id AS id, u.id AS userid, u.username, f.role, f.deleted, f.updated_at
     FROM following f
     JOIN users u ON u.id = f.userid
     WHERE f.spaceid = $1 AND f.updated_at > $2`,
    [spaceId, since],
  );
  return rows;
};

export const getSpaceMemberCount = async (
  spaceId: number,
  client: DbClient = pool,
): Promise<number> => {
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanSpaceId)) return 0;

  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM following WHERE spaceid = $1 AND deleted = false`,
    [cleanSpaceId],
  );
  return rows[0]?.count ?? 0;
};

export const changeUserRole = async (
  {
    spaceId,
    userId,
    role,
  }: { spaceId: number; userId: number; role: Role },
  client: DbClient = pool,
): Promise<Member | null> => {
  const cleanSpaceId = Number(spaceId);
  const cleanUserId = Number(userId);

  if (!Number.isFinite(cleanSpaceId) || !Number.isFinite(cleanUserId)) return null;

  const { rows } = await client.query<Member>(
    `UPDATE following SET role = $1
     WHERE userid = $2 AND spaceid = $3
     RETURNING userid, spaceid, role`,
    [role, cleanUserId, cleanSpaceId],
  );
  return rows[0] ?? null;
};

export const getPendingRoleRequest = async (
  { userId, spaceId }: { userId: number; spaceId: number },
  client: DbClient = pool,
): Promise<RoleRequest | null> => {
  const cleanUserId = Number(userId);
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanUserId) || !Number.isFinite(cleanSpaceId)) return null;

  const { rows } = await client.query<RoleRequest>(
    `SELECT id, user_id, space_id, role, status, created_at, expires_at
     FROM role_requests
     WHERE user_id = $1
       AND space_id = $2
       AND status = 'pending'
       AND deleted = false
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC
     LIMIT 1`,
    [cleanUserId, cleanSpaceId],
  );
  return rows[0] ?? null;
};

export const createRoleRequest = async (
  { userId, spaceId, role }: { userId: number; spaceId: number; role: Role },
  client: DbClient = pool,
): Promise<RoleRequest> => {
  const cleanUserId = Number(userId);
  const cleanSpaceId = Number(spaceId);

  if (!Number.isFinite(cleanUserId) || !Number.isFinite(cleanSpaceId)) {
    throw Object.assign(new Error('Invalid role request'), { statusCode: 400 });
  }

  try {
    await client.query(
      `UPDATE role_requests SET status = 'rejected'
       WHERE user_id = $1
         AND space_id = $2
         AND status = 'pending'
         AND (deleted = true OR (expires_at IS NOT NULL AND expires_at < NOW()))`,
      [cleanUserId, cleanSpaceId],
    );

    const { rows } = await client.query<RoleRequest>(
      `INSERT INTO role_requests (user_id, space_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, role, status, created_at, expires_at`,
      [cleanUserId, cleanSpaceId, role],
    );
    return rows[0];
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('A pending request already exists'), {
        statusCode: 409,
        error: 'pending_request_exists',
      });
    }
    throw err;
  }
};

export const deleteRoleRequest = async (
  { userId, spaceId }: { userId: number; spaceId: number },
  client: DbClient = pool,
): Promise<number> => {
  const cleanUserId = Number(userId);
  const cleanSpaceId = Number(spaceId);
  if (!Number.isFinite(cleanUserId) || !Number.isFinite(cleanSpaceId)) return 0;

  const { rowCount } = await client.query(
    `UPDATE role_requests SET deleted = true
     WHERE user_id = $1 AND space_id = $2 AND status = 'pending' AND deleted = false`,
    [cleanUserId, cleanSpaceId],
  );
  return rowCount ?? 0;
};

export const removeUserFromSpace = async (
  { spaceId, userId }: { spaceId: number; userId: number },
  client: DbClient = pool,
): Promise<boolean> => {
  const cleanSpaceId = Number(spaceId);
  const cleanUserId = Number(userId);
  if (!Number.isFinite(cleanSpaceId) || !Number.isFinite(cleanUserId)) return false;

  const { rowCount } = await client.query(
    `UPDATE following SET deleted = true
     WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
    [cleanSpaceId, cleanUserId],
  );
  return (rowCount ?? 0) > 0;
};
