import { useEffect, useRef, useState } from "react";
import { changeRoleInSpace } from "../Api";
import { useDeltaSync } from "./useDeltaSync";

const API = "http://localhost:3000";

export default function useSpaceView({ id, token, userId }) {
  const [space, setSpace] = useState(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [spaceError, setSpaceError] = useState(null);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState(null);
  const [roleUpdateError, setRoleUpdateError] = useState(null);
  const membersSinceRef = useRef(null);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

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

  const {
    data: members,
    loading: membersLoading,
    sync: fetchMembers,
  } = useDeltaSync(`${API}/spaces/${id}/members`, {
    token,
    interval: 20_000,
  });

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
