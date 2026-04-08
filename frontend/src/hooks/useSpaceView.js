import { useEffect, useRef, useState } from "react";
import { changeRoleInSpace } from "../Api";
import { POLL_INTERVAL } from "../constants";

const API = "http://localhost:3000";

export default function useSpaceView({ id, token, userId }) {
  const [space, setSpace] = useState(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [spaceError, setSpaceError] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
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

  const fetchMembers = (since = null) => {
    if (!token) return;
    const url = since
      ? `${API}/spaces/${id}/members?since=${encodeURIComponent(since)}`
      : `${API}/spaces/${id}/members`;
    const fetchedAt = new Date().toISOString();
    if (!since) setMembersLoading(true);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (r.status === 403 || r.status === 404) {
          const err = new Error(data?.error || 'access_denied');
          err.status = r.status;
          setSpaceError(err);
          return null;
        }
        if (!r.ok) return null;
        return data;
      })
      .then((data) => {
        if (!data) return;
        const delta = data.members || [];
        if (!since) {
          const active = delta.filter((m) => !m.deleted);
          setMembers(active);
          const me = active.find((m) => m.userid === userIdRef.current);
          if (me) setSpace((s) => s ? { ...s, role: me.role } : s);
        } else {
          setMembers((prev) => {
            const map = new Map(prev.map((m) => [m.userid, m]));
            for (const m of delta) {
              if (m.deleted) map.delete(m.userid);
              else map.set(m.userid, m);
            }
            return Array.from(map.values());
          });
          const me = delta.find((m) => m.userid === userIdRef.current && !m.deleted);
          if (me) setSpace((s) => s ? { ...s, role: me.role } : s);
        }
        membersSinceRef.current = fetchedAt;
      })
      .catch(() => { if (!since) setMembers([]); })
      .finally(() => { if (!since) setMembersLoading(false); });
  };

  useEffect(() => {
    if (!token) return;
    membersSinceRef.current = null;
    fetchMembers();
    const interval = setInterval(() => {
      fetchMembers(membersSinceRef.current);
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [id, token]);

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
