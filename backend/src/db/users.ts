import pool from './pool';
import type { User, UserWithHash, UserSearchResult } from '../types';

export const createUser = async (
  username: string,
  email: string,
  passwordHash: string,
): Promise<User> => {
  const { rows } = await pool.query<User>(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id, username, email`,
    [username, email, passwordHash],
  );
  return rows[0];
};

export const findUserById = async (id: number): Promise<User | null> => {
  const { rows } = await pool.query<User>(
    `SELECT id, username, email FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findUserByEmail = async (email: string): Promise<UserWithHash | null> => {
  const { rows } = await pool.query<UserWithHash>(
    `SELECT id, username, email, password_hash, created_at FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
};

export const findUserByUsername = async (username: string): Promise<User | null> => {
  const { rows } = await pool.query<User>(
    `SELECT id, username, email, created_at FROM users WHERE username = $1`,
    [username],
  );
  return rows[0] ?? null;
};

export const searchUsers = async ({
  prefix,
  excludeUserId,
  limit = 20,
}: {
  prefix: string;
  excludeUserId: number;
  limit?: number;
}): Promise<UserSearchResult[]> => {
  const cleanPrefix = (prefix || '').trim();
  if (!cleanPrefix) return [];

  const { rows } = await pool.query<{
    id: number;
    username: string;
    is_friend: boolean;
    has_pending_request: boolean;
  }>(
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
    [cleanPrefix, excludeUserId, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    relationship: r.is_friend ? 'friends' : r.has_pending_request ? 'pending' : 'none',
  }));
};
