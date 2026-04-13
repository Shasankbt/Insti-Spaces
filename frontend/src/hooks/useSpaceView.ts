import { useEffect, useRef, useState } from 'react';
import { changeRoleInSpace, removeMember } from '../Api';
import { useDeltaSync } from './useDeltaSync';
import type { Space, Member, Role } from '../types';

const API = 'http://localhost:3000';

interface UseSpaceViewOptions {
  id: string | undefined;
  token: string | null;
  userId: number | undefined;
}

interface UseSpaceViewResult {
  space: Space | null;
  spaceLoading: boolean;
  spaceError: Error | null;
  members: Member[];
  membersLoading: boolean;
  roleUpdatingUserId: number | null;
  roleUpdateError: string | null;
  removingUserId: number | null;
  removeError: string | null;
  handleRoleChange: (args: { username: string; userId: number; role: Role }) => Promise<void>;
  handleRemoveMember: (args: { userId: number }) => Promise<void>;
  fetchMembers: () => Promise<void>;
}

export default function useSpaceView({
  id,
  token,
  userId,
}: UseSpaceViewOptions): UseSpaceViewResult {
  const [space, setSpace] = useState<Space | null>(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [spaceError, setSpaceError] = useState<Error | null>(null);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState<number | null>(null);
  const [roleUpdateError, setRoleUpdateError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!token) return;
    setSpaceLoading(true);
    setSpaceError(null);
    fetch(`${API}/spaces/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { space?: Space; error?: string };
        if (!r.ok) {
          const err = Object.assign(new Error(data?.error ?? 'Failed to load space'), {
            status: r.status,
            data,
          });
          throw err;
        }
        setSpace(data.space ?? null);
      })
      .catch((err: Error) => {
        setSpace(null);
        setSpaceError(err);
      })
      .finally(() => setSpaceLoading(false));
  }, [id, token]);

  const {
    data: members,
    loading: membersLoading,
    sync: fetchMembers,
  } = useDeltaSync<Member>(`${API}/spaces/${id}/members`, {
    token,
    interval: 5_000,
  });

  const handleRoleChange = async ({
    username,
    userId: targetUserId,
    role,
  }: {
    username: string;
    userId: number;
    role: Role;
  }): Promise<void> => {
    setRoleUpdateError(null);
    try {
      setRoleUpdatingUserId(targetUserId);
      if (!space) return;
      await changeRoleInSpace({ spaceId: space.id, username, role, token: token! });
      void fetchMembers();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { message?: string; error?: string } } })
        .response?.data;
      setRoleUpdateError(apiErr?.message ?? apiErr?.error ?? 'Failed to change role');
    } finally {
      setRoleUpdatingUserId(null);
    }
  };

  const handleRemoveMember = async ({ userId: targetUserId }: { userId: number }): Promise<void> => {
    setRemoveError(null);
    try {
      setRemovingUserId(targetUserId);
      if (!space) return;
      await removeMember({ spaceId: space.id, userId: targetUserId, token: token! });
      void fetchMembers();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { message?: string; error?: string } } })
        .response?.data;
      setRemoveError(apiErr?.message ?? apiErr?.error ?? 'Failed to remove member');
    } finally {
      setRemovingUserId(null);
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
    removingUserId,
    removeError,
    handleRoleChange,
    handleRemoveMember,
    fetchMembers,
  };
}
