// ── Domain types ─────────────────────────────────────────────────────────────

export type Role = 'viewer' | 'contributor' | 'moderator' | 'admin';

export type RequestableRole = 'contributor' | 'moderator';

export type RoleRequestStatus = 'pending' | 'accepted' | 'rejected';

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';

// ── DB row shapes ─────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string;
}

export interface UserWithHash extends User {
  password_hash: string;
  created_at: Date;
}

/** Row from the `following` table */
export interface Member {
  userid: number;
  spaceid: number;
  role: Role;
}

export interface Space {
  id: number;
  spacename: string;
  created_at: Date;
}

export interface SpaceWithRole extends Space {
  role: Role;
}

export interface RoleRequest {
  id: number;
  user_id: number;
  space_id: number;
  role: Role;
  status: RoleRequestStatus;
  created_at: Date;
  expires_at: Date | null;
}

export interface InviteLink {
  id: number;
  token: string;
  space_id: number;
  role: Role;
  expires_at: Date | null;
  single_use: boolean;
  used: boolean;
  created_at: Date;
}

export interface FriendRequest {
  id: number;
  from_user_id: number;
  to_user_id: number;
  status: FriendRequestStatus;
  created_at: Date;
  responded_at: Date | null;
}

export interface Friend {
  id: number;
  username: string;
  updated_at: Date;
}

export interface UserSearchResult {
  id: number;
  username: string;
  relationship: 'friends' | 'pending' | 'none';
}

// ── JWT payload ───────────────────────────────────────────────────────────────

export interface JwtPayload {
  id: number;
  username: string;
}

// ── Express request augmentation ─────────────────────────────────────────────
// Adds typed properties set by our middleware to Express.Request.

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` middleware after JWT verification. */
      user: JwtPayload;
      /** Set by `isMember` middleware — the caller's membership row. */
      member: Member;
      /** Set by `deltaSync` middleware — the high-water timestamp to query from. */
      since: Date;
    }
  }
}
