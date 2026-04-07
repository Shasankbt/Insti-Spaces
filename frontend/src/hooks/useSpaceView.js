import { useEffect, useState } from "react";
import { changeRoleInSpace } from "../Api";

const API = "http://localhost:3000";

export default function useSpaceView({ id, token }) {
  const [space, setSpace] = useState(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [spaceError, setSpaceError] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState(null);
  const [roleUpdateError, setRoleUpdateError] = useState(null);

  useEffect(() => {
    if (!token) return;
    setSpaceLoading(true);
    setSpaceError(null);
    fetch(`${API}/spaces/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = new Error(data?.error || "Failed to load space");
          err.status = r.status;
          err.data = data;
          throw err;
        }
        setSpace(data.space);
      })
      .catch((err) => {
        setSpace(null);
        setSpaceError(err);
      })
      .finally(() => setSpaceLoading(false));
  }, [id, token]);

  const fetchMembers = () => {
    if (!token) return;
    setMembersLoading(true);
    fetch(`${API}/spaces/${id}/members`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return { members: [] };
        return data;
      })
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

  return {
    space,
    spaceLoading,
    spaceError,
    members,
    membersLoading,
    roleUpdatingUserId,
    roleUpdateError,
    handleRoleChange,
    fetchMembers,
  };
}
