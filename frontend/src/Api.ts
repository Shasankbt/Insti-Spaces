import axios from 'axios';
import type { ExplorerResponse, Role, SpaceItem, SpacePhoto, TrashedFolder } from './types';
import { API_BASE as API } from './constants';

const authHeaders = (token: string) => ({
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

export const registerUser = (data: { username: string; email: string; password: string }) =>
  axios.post(`${API}/auth/register`, data);

export const loginUser = (data: { email: string; password: string }) =>
  axios.post(`${API}/auth/login`, data);

export const searchUsers = ({ prefix, token }: { prefix: string; token: string }) =>
  axios.get(`${API}/user/search`, {
    params: { prefix },
    ...authHeaders(token),
  });

export const getNotifications = ({ token, since }: { token: string; since?: string }) =>
  axios.get(`${API}/user/notifications`, {
    params: since ? { since } : {},
    ...authHeaders(token),
  });

export const acceptFriendRequest = ({
  requestId,
  token,
}: {
  requestId: number;
  token: string;
}) => axios.post(`${API}/friends/friend-requests/${requestId}/accept`, {}, authHeaders(token));

export const createFriendRequest = ({
  toUserId,
  token,
}: {
  toUserId: number;
  token: string;
}) => axios.post(`${API}/friends/friend-requests`, { toUserId }, authHeaders(token));

export const getFriends = ({ token }: { token: string }) =>
  axios.get(`${API}/friends`, authHeaders(token));

export const createSpace = ({ spacename, token }: { spacename: string; token: string }) =>
  axios.post(`${API}/spaces/create`, { spacename }, authHeaders(token));

export const getFollowingSpaces = ({
  token,
  since,
}: {
  token: string;
  since?: string;
}) =>
  axios.get(`${API}/spaces`, {
    params: since ? { since } : {},
    ...authHeaders(token),
  });

export const inviteToSpace = ({
  spaceId,
  username,
  userId,
  role,
  token,
}: {
  spaceId: number;
  username?: string;
  userId?: number;
  role: Role;
  token: string;
}) => axios.post(`${API}/spaces/${spaceId}/invite`, { username, userId, role }, authHeaders(token));

export const removeMember = ({
  spaceId,
  userId,
  token,
}: {
  spaceId: number;
  userId: number;
  token: string;
}) => axios.delete(`${API}/spaces/${spaceId}/members/${userId}`, authHeaders(token));

export const generateSpaceInviteLink = ({
  spaceId,
  token,
}: {
  spaceId: number;
  token: string;
}) => axios.get(`${API}/spaces/${spaceId}/generate-invite-link`, authHeaders(token));

export const leaveSpace = ({ spaceId, token }: { spaceId: number; token: string }) =>
  axios.delete(`${API}/spaces/${spaceId}/leave`, authHeaders(token));

export const deleteSpace = ({ spaceId, token }: { spaceId: number; token: string }) =>
  axios.delete(`${API}/spaces/${spaceId}`, {
    ...authHeaders(token),
    data: { confirm: true },
  });

export const changeRoleInSpace = ({
  spaceId,
  username,
  role,
  token,
}: {
  spaceId: number;
  username: string;
  role: Role;
  token: string;
}) => axios.post(`${API}/spaces/${spaceId}/changeRole`, { username, role }, authHeaders(token));

export const getRoleRequest = ({ spaceId, token }: { spaceId: number; token: string }) =>
  axios.get(`${API}/spaces/${spaceId}/requestRole`, authHeaders(token));

export const requestRole = ({
  spaceId,
  role,
  token,
}: {
  spaceId: number;
  role: Role;
  token: string;
}) => axios.post(`${API}/spaces/${spaceId}/requestRole`, { role }, authHeaders(token));

export const cancelRoleRequest = ({ spaceId, token }: { spaceId: number; token: string }) =>
  axios.delete(`${API}/spaces/${spaceId}/requestRole`, authHeaders(token));

export const acceptRoleRequest = ({
  spaceId,
  requestId,
  token,
}: {
  spaceId: number;
  requestId: number;
  token: string;
}) =>
  axios.post(`${API}/spaces/${spaceId}/roleRequests/${requestId}/accept`, {}, authHeaders(token));

export const rejectRoleRequest = ({
  spaceId,
  requestId,
  token,
}: {
  spaceId: number;
  requestId: number;
  token: string;
}) =>
  axios.post(`${API}/spaces/${spaceId}/roleRequests/${requestId}/reject`, {}, authHeaders(token));

export const createSpaceFolder = ({
  spaceId,
  name,
  parentId,
  token,
}: {
  spaceId: number;
  name: string;
  parentId?: number | null;
  token: string;
}) =>
  axios.post(
    `${API}/spaces/${spaceId}/folders`,
    { name, parent_id: parentId ?? null },
    authHeaders(token),
  );

export const moveSpaceFolder = ({
  spaceId,
  folderId,
  parentId,
  token,
}: {
  spaceId: number;
  folderId: number;
  parentId: number | null;
  token: string;
}) =>
  axios.patch(
    `${API}/spaces/${spaceId}/folders/${folderId}/move`,
    { parent_id: parentId },
    authHeaders(token),
  );

export const deleteSpaceFolder = ({
  spaceId,
  folderId,
  token,
}: {
  spaceId: number;
  folderId: number;
  token: string;
}) => axios.delete(`${API}/spaces/${spaceId}/folders/${folderId}`, authHeaders(token));

export const copySpaceFolder = ({
  spaceId,
  folderId,
  targetParentId,
  token,
}: {
  spaceId: number;
  folderId: number;
  targetParentId: number | null;
  token: string;
}) =>
  axios.post<{ itemCount: number }>(
    `${API}/spaces/${spaceId}/folders/${folderId}/copy`,
    { targetParentId },
    authHeaders(token),
  );

export const uploadToSpace = ({
  spaceId,
  formData,
  token,
}: {
  spaceId: number;
  formData: FormData;
  token: string;
}) =>
  axios.post(`${API}/spaces/${spaceId}/upload`, formData, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

export const checkSpaceItemHashes = ({
  spaceId,
  hashes,
  token,
}: {
  spaceId: number;
  hashes: string[];
  token: string;
}) =>
  axios.post<{ existingHashes: string[] }>(
    `${API}/spaces/${spaceId}/items/hash-check`,
    { hashes },
    authHeaders(token),
  );

export const getSpacePageView = ({
  spaceId,
  token,
  limit,
}: {
  spaceId: number;
  token: string;
  limit?: number;
}) =>
  axios.get<{ photos: SpacePhoto[] }>(`${API}/spaces/${spaceId}/pageview`, {
    params: limit ? { limit } : {},
    ...authHeaders(token),
  });

export const getSpaceExplorer = ({
  spaceId,
  token,
  path,
}: {
  spaceId: number;
  token: string;
  path?: string;
}) =>
  axios.get<ExplorerResponse>(`${API}/spaces/${spaceId}/explorer`, {
    params: path ? { path } : {},
    ...authHeaders(token),
  });

export const downloadSelected = async ({
  spaceId,
  token,
  itemIds,
  folderIds,
}: {
  spaceId: number;
  token: string;
  itemIds: string[];
  folderIds: number[];
}): Promise<void> => {
  const res = await fetch(`${API}/spaces/${spaceId}/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds, folderIds }),
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'download.zip';
  a.click();
  URL.revokeObjectURL(url);
};

export type ItemConflict = { itemId: string; displayName: string };
export type ConflictResolution = 'skip' | 'replace' | 'keep_both';

export const trashItems = ({
  spaceId,
  token,
  itemIds,
}: {
  spaceId: number;
  token: string;
  itemIds: string[];
}) =>
  axios.post<{ count: number }>(
    `${API}/spaces/${spaceId}/item-action/trash`,
    { itemIds },
    authHeaders(token),
  );

export const moveItems = ({
  spaceId,
  token,
  itemIds,
  folderId,
  resolutions,
}: {
  spaceId: number;
  token: string;
  itemIds: string[];
  folderId: number | null;
  resolutions?: Record<string, ConflictResolution>;
}) =>
  axios.patch<{ count: number; skipped: number }>(
    `${API}/spaces/${spaceId}/item-action/move`,
    { itemIds, folderId, resolutions },
    authHeaders(token),
  );

export const copyItems = ({
  spaceId,
  token,
  itemIds,
  folderId,
  resolutions,
}: {
  spaceId: number;
  token: string;
  itemIds: string[];
  folderId: number | null;
  resolutions?: Record<string, ConflictResolution>;
}) =>
  axios.post<{ count: number; skipped: number }>(
    `${API}/spaces/${spaceId}/item-action/copy`,
    { itemIds, folderId, resolutions },
    authHeaders(token),
  );

export const likeSpaceItem = ({
  spaceId,
  itemId,
  token,
}: {
  spaceId: number;
  itemId: string;
  token: string;
}) =>
  axios.post<{ likeCount: number; likedByMe: boolean }>(
    `${API}/spaces/${spaceId}/items/${itemId}/like`,
    {},
    authHeaders(token),
  );

export const unlikeSpaceItem = ({
  spaceId,
  itemId,
  token,
}: {
  spaceId: number;
  itemId: string;
  token: string;
}) =>
  axios.delete<{ likeCount: number; likedByMe: boolean }>(
    `${API}/spaces/${spaceId}/items/${itemId}/like`,
    authHeaders(token),
  );

export const renameSpaceItem = ({
  spaceId,
  itemId,
  displayName,
  token,
}: {
  spaceId: number;
  itemId: string;
  displayName: string;
  token: string;
}) =>
  axios.patch(
    `${API}/spaces/${spaceId}/items/${itemId}/rename`,
    { displayName },
    authHeaders(token),
  );


export const getSpaceTrash = ({
  spaceId,
  token,
  limit = 50,
  offset = 0,
}: {
  spaceId: number;
  token: string;
  limit?: number;
  offset?: number;
}) =>
  axios.get<{ items: SpaceItem[]; folders: TrashedFolder[]; hasMore: boolean }>(`${API}/spaces/${spaceId}/trash`, {
    params: { limit, offset },
    ...authHeaders(token),
  });

export const getSpaceTrashFolderItems = ({
  spaceId,
  folderId,
  token,
}: {
  spaceId: number;
  folderId: number;
  token: string;
}) =>
  axios.get<{ items: SpaceItem[]; folders: { id: number; name: string }[] }>(`${API}/spaces/${spaceId}/folders/${folderId}/trash-items`, authHeaders(token));

export const restoreSpaceTrashFolder = ({
  spaceId,
  folderId,
  token,
}: {
  spaceId: number;
  folderId: number;
  token: string;
}) =>
  axios.post(`${API}/spaces/${spaceId}/folders/${folderId}/restore`, {}, authHeaders(token));

export const permanentlyDeleteSpaceTrashFolder = ({
  spaceId,
  folderId,
  token,
}: {
  spaceId: number;
  folderId: number;
  token: string;
}) =>
  axios.delete(`${API}/spaces/${spaceId}/folders/${folderId}/trash`, authHeaders(token));

export const restoreSpaceTrashItem = ({
  spaceId,
  itemId,
  token,
}: {
  spaceId: number;
  itemId: string;
  token: string;
}) =>
  axios.post<{ item: SpaceItem }>(
    `${API}/spaces/${spaceId}/trash/${itemId}/restore`,
    {},
    authHeaders(token),
  );

export const permanentlyDeleteSpaceTrashItem = ({
  spaceId,
  itemId,
  token,
}: {
  spaceId: number;
  itemId: string;
  token: string;
}) => axios.delete(`${API}/spaces/${spaceId}/trash/${itemId}`, authHeaders(token));

export const emptySpaceTrash = ({ spaceId, token }: { spaceId: number; token: string }) =>
  axios.delete(`${API}/spaces/${spaceId}/trash`, authHeaders(token));
