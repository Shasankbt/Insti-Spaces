import axios from "axios";

const API = "http://localhost:3000";

const authHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

export const registerUser = (data) => axios.post(`${API}/auth/register`, data);
export const loginUser = (data) => axios.post(`${API}/auth/login`, data);

export const searchUsers = ({ prefix, token }) =>
  axios.get(`${API}/user/search`, {
    params: { prefix },
    ...authHeaders(token),
  });

export const getNotifications = ({ token }) =>
  axios.get(`${API}/user/notifications`, authHeaders(token));

export const acceptFriendRequest = ({ requestId, token }) =>
  axios.post(
    `${API}/friends/friend-requests/${requestId}/accept`,
    {},
    authHeaders(token),
  );

export const createFriendRequest = ({ toUserId, token }) =>
  axios.post(
    `${API}/friends/friend-requests`,
    { toUserId },
    authHeaders(token),
  );

export const getFriends = ({ token }) =>
  axios.get(`${API}/friends`, authHeaders(token));

export const createSpace = ({ spacename, token }) =>
  axios.post(`${API}/spaces/create`, { spacename }, authHeaders(token));

export const getFollowingSpaces = ({ token }) =>
  axios.get(`${API}/spaces`, authHeaders(token));

export const inviteToSpace = ({ spaceId, username, token }) =>
  axios.post(
    `${API}/spaces/${spaceId}/invite`,
    { username },
    authHeaders(token),
  );

export const generateSpaceInviteLink = ({ spaceId, token }) =>
  axios.get(
    `${API}/spaces/${spaceId}/generate-invite-link`,
    authHeaders(token),
  );

export const leaveSpace = ({ spaceId, token }) =>
  axios.delete(`${API}/spaces/${spaceId}/leave`, authHeaders(token));

export const deleteSpace = ({ spaceId, token }) =>
  axios.delete(`${API}/spaces/${spaceId}`, {
    ...authHeaders(token),
    data: { confirm: true },
  });

export const changeRoleInSpace = ({ spaceId, username, role, token }) =>
  axios.post(
    `${API}/spaces/${spaceId}/changeRole`,
    { username, role },
    authHeaders(token),
  );

export const getRoleRequest = ({ spaceId, token }) =>
  axios.get(`${API}/spaces/${spaceId}/requestRole`, authHeaders(token));

export const requestRole = ({ spaceId, role, token }) =>
  axios.post(
    `${API}/spaces/${spaceId}/requestRole`,
    { role },
    authHeaders(token),
  );

export const cancelRoleRequest = ({ spaceId, token }) =>
  axios.delete(`${API}/spaces/${spaceId}/requestRole`, authHeaders(token));

export const acceptRoleRequest = ({ spaceId, requestId, token }) =>
  axios.post(
    `${API}/spaces/${spaceId}/roleRequests/${requestId}/accept`,
    {},
    authHeaders(token),
  );

export const rejectRoleRequest = ({ spaceId, requestId, token }) =>
  axios.post(
    `${API}/spaces/${spaceId}/roleRequests/${requestId}/reject`,
    {},
    authHeaders(token),
  );

export const contributeToSpace = ({ spaceId, formData, token }) =>
  axios.post(`${API}/spaces/${spaceId}/contribute`, formData, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "multipart/form-data",
    },
  });
