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
