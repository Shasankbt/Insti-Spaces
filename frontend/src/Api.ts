import axios from 'axios';
import type { Role, SpacePhoto } from './types';

const API = 'http://localhost:3000';

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
      'Content-Type': 'multipart/form-data',
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
