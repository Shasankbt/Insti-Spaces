import { useEffect, useRef, useState } from "react";
import { changeRoleInSpace, removeMemberFromSpace, transferSpaceOwnership } from "../Api";
import { useDeltaSync } from "./useDeltaSync";

const API = "http://localhost:3000";

export default function useSpaceView({ id, token, userId }) {
  const [space, setSpace] = useState(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [spaceError, setSpaceError] = useState(null);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState(null);
  const [roleUpdateError, setRoleUpdateError] = useState(null);
  const [memberActionUserId, setMemberActionUserId] = useState(null);
  const [memberActionError, setMemberActionError] = useState(null);
  const membersSinceRef = useRef(null);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  const fetchSpace = () => {
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
  };

  useEffect(() => {
    fetchSpace();
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
    setMemberActionError(null);
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

  const handleRemoveMember = async ({ userId }) => {
    setRoleUpdateError(null);
    setMemberActionError(null);
    try {
      setMemberActionUserId(userId);
      await removeMemberFromSpace({ spaceId: space.id, userId, token });
      fetchMembers();
    } catch (err) {
      const apiErr = err.response?.data;
      setMemberActionError(apiErr?.message || apiErr?.error || "Failed to remove member");
    } finally {
      setMemberActionUserId(null);
    }
  };

  const handleTransferOwnership = async ({ userId }) => {
    setRoleUpdateError(null);
    setMemberActionError(null);
    try {
      setMemberActionUserId(userId);
      const res = await transferSpaceOwnership({ spaceId: space.id, userId, token });
      setSpace((prev) => ({ ...prev, ...res.data.space }));
      fetchMembers();
    } catch (err) {
      const apiErr = err.response?.data;
      setMemberActionError(apiErr?.message || apiErr?.error || "Failed to transfer main admin");
    } finally {
      setMemberActionUserId(null);
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
    memberActionUserId,
    memberActionError,
    handleRoleChange,
    handleRemoveMember,
    handleTransferOwnership,
    fetchMembers,
    fetchSpace,
  };
}
