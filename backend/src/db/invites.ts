import pool from './pool';
import type { InviteLink, Role } from '../types';

interface GenerateInviteLinkParams {
  spaceId: number;
  role: Role;
  /** Absolute Date for expiry, or `null` for never-expires. Default: 30 days. */
  expiresAt?: Date | null;
  /** Single-use links self-revoke after one accept. Default: false. */
  singleUse?: boolean;
}

const DEFAULT_EXPIRY_INTERVAL = "30 days";

export const generateInviteLink = async (
  params: GenerateInviteLinkParams,
): Promise<{ id: number; token: string }> => {
  const { spaceId, role, expiresAt, singleUse = false } = params;

  // expiresAt undefined → use the SQL default of NOW() + 30 days.
  // expiresAt null      → explicitly never expires.
  // expiresAt Date      → use that exact timestamp.
  const useDefaultExpiry = expiresAt === undefined;

  const { rows } = await pool.query<{ id: number; token: string }>(
    `INSERT INTO invite_links (space_id, role, expires_at, single_use)
     VALUES (
       $1,
       $2,
       ${useDefaultExpiry ? `NOW() + INTERVAL '${DEFAULT_EXPIRY_INTERVAL}'` : '$3'},
       ${useDefaultExpiry ? '$3' : '$4'}
     )
     RETURNING id, token`,
    useDefaultExpiry
      ? [spaceId, role, singleUse]
      : [spaceId, role, expiresAt, singleUse],
  );
  return rows[0];
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

/**
 * Lists invite links that are still issuable: not expired, and either
 * multi-use OR single-use-and-not-yet-redeemed. Ordered newest first.
 */
export const listInviteLinks = async (spaceId: number): Promise<InviteLink[]> => {
  const { rows } = await pool.query<InviteLink>(
    `SELECT id, token, space_id, role, expires_at, single_use, used, created_at
       FROM invite_links
      WHERE space_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (single_use = FALSE OR used = FALSE)
      ORDER BY created_at DESC`,
    [spaceId],
  );
  return rows;
};

/**
 * Hard-deletes an invite link. Returns true if a row was removed (caller
 * uses this to distinguish "revoked" from "wrong space / already gone").
 */
export const deleteInviteLink = async ({
  id,
  spaceId,
}: {
  id: number;
  spaceId: number;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `DELETE FROM invite_links WHERE id = $1 AND space_id = $2`,
    [id, spaceId],
  );
  return (rowCount ?? 0) > 0;
};
