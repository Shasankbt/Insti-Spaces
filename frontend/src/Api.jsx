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
  axios.get(`${API}/users/search`, {
    params: { prefix },
    ...authHeaders(token),
  });

export const getNotifications = ({ token }) =>
  axios.get(`${API}/notifications`, authHeaders(token));

export const acceptFriendRequest = ({ requestId, token }) =>
  axios.post(
    `${API}/friend-requests/${requestId}/accept`,
    {},
    authHeaders(token),
  );

export const createFriendRequest = ({ toUserId, token }) =>
  axios.post(
    `${API}/friend-requests`,
    { toUserId },
    authHeaders(token),
  );
