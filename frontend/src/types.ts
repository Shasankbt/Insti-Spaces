// ── Domain types (mirrored from backend) ─────────────────────────────────────

export type Role = 'viewer' | 'contributor' | 'moderator' | 'admin';

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface AuthUser {
  id: number;
  username: string;
}

export interface Space {
  id: number;
  spacename: string;
  role: Role;
  created_at?: string;
}

export interface Member {
  userid: number;
  spaceid?: number;
  username: string;
  role: Role;
  deleted?: boolean;
  updated_at?: string;
}

export interface Friend {
  id: number;
  username: string;
  updated_at?: string;
}

export interface UserSearchResult {
  id: number;
  username: string;
  relationship: 'friends' | 'pending' | 'none';
}

export interface SpaceFolder {
  id: number;
  space_id: number;
  created_by: number;
  name: string;
  parent_id: number | null;
  updated_at: string;
  deleted: boolean;
}

export interface RoleRequest {
  id: number;
  role: Role;
  status: string;
  created_at: string;
  expires_at: string | null;
}

export interface SpacePhoto {
  photoId: string;
  displayName: string;
  uploadedAt: string;
  mimeType: string;
  likeCount: number;
  likedByMe: boolean;
}

export interface SpaceItem {
  itemId: string;
  displayName: string;
  uploadedAt: string;
  mimeType: string;
  sizeBytes: number;
  folderId: number | null;
  trashedAt?: string | null;
  expiresAt?: string | null;
}

export interface ExplorerFolder {
  id: number;
  name: string;
  parentId: number | null;
}

export interface ExplorerResponse {
  currentFolder: ExplorerFolder | null;
  breadcrumbs: ExplorerFolder[];
}

// ── Notification union ────────────────────────────────────────────────────────

export interface FriendRequestNotification {
  uid: string;
  id: number;
  type: 'friend_request';
  from_user_id: number;
  to_user_id: number;
  status: FriendRequestStatus;
  from_username: string;
  to_username: string;
  created_at: string;
  responded_at: string | null;
  deleted: boolean;
}

export interface RoleRequestNotification {
  uid: string;
  id: number;
  type: 'role_request';
  from_user_id: number;
  from_username: string;
  status: string;
  space_id: number;
  spacename: string;
  requested_role: Role;
  created_at: string;
  deleted: boolean;
}

export type Notification = FriendRequestNotification | RoleRequestNotification;

// ── Auth context ──────────────────────────────────────────────────────────────

export interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  loading: boolean;
}
