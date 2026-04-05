import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changeRoleInSpace } from "../Api";

const API = "http://localhost:3000";

export default function useSpaceView({ id, token }) {
  const navigate = useNavigate();
  const [space, setSpace] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState(null);
  const [roleUpdateError, setRoleUpdateError] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/spaces/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setSpace(data.space))
      .catch(() => navigate("/spaces"));
  }, [id, token]);

  const fetchMembers = () => {
    if (!token) return;
    setMembersLoading(true);
    fetch(`${API}/spaces/${id}/members`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  };

  useEffect(() => { fetchMembers(); }, [id, token]);

  const handleRoleChange = async ({ username, userId, role }) => {
    setRoleUpdateError(null);
    try {
      setRoleUpdatingUserId(userId);
      await changeRoleInSpace({ spaceId: space.id, username, role, token });
      fetchMembers();
    } catch (err) {
      const apiErr = err.response?.data;
      setRoleUpdateError(apiErr?.message || apiErr?.error || "Failed to change role");
    } finally {
      setRoleUpdatingUserId(null);
    }
  };

  return { space, members, membersLoading, roleUpdatingUserId, roleUpdateError, handleRoleChange };
}
