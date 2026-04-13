import pool from './pool';
import type { InviteLink, Role } from '../types';

export const generateInviteLink = async (spaceId: number, role: Role): Promise<string> => {
  const { rows } = await pool.query<{ token: string }>(
    `INSERT INTO invite_links (space_id, role, expires_at, single_use)
     VALUES ($1, $2, NOW() + INTERVAL '30 days', FALSE)
     RETURNING token`,
    [spaceId, role],
  );
  return rows[0].token;
};

export const fetchInviteLink = async (token: string): Promise<InviteLink | null> => {
  const { rows } = await pool.query<InviteLink>(
    `SELECT id, token, space_id, role, expires_at, single_use, used, created_at
     FROM invite_links
     WHERE token = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (single_use = FALSE OR used = FALSE)`,
    [token],
  );
  return rows[0] ?? null;
};

export const markLinkInviteUsed = async (token: string): Promise<void> => {
  await pool.query(`UPDATE invite_links SET used = TRUE WHERE token = $1`, [token]);
};
