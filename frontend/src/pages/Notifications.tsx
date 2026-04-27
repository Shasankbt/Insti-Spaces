import { useState } from 'react';
import useRequireAuth from '../hooks/useRequireAuth';
import { acceptFriendRequest, acceptRoleRequest, rejectRoleRequest } from '../Api';
import { useDeltaSync } from '../hooks/useDeltaSync';
import { API_BASE, POLL_INTERVAL } from '../constants';
import type { Notification, FriendRequestNotification, RoleRequestNotification } from '../types';

export default function Notifications() {
  const { user, token, loading: authLoading, isAuthenticated } = useRequireAuth();

  const {
    data: items,
    loading,
    error,
    refresh,
  } = useDeltaSync<Notification>(`${API_BASE}/user/notifications`, {
    token,
    interval: POLL_INTERVAL,
    pause: !isAuthenticated,
    idKey: 'uid',
  });

  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const onAccept = async (requestId: number) => {
    setActionError(null);
    try {
      setAcceptingId(requestId);
      await acceptFriendRequest({ requestId, token: token! });
      await refresh();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setActionError(apiErr?.error ?? 'Failed to accept request');
    } finally {
      setAcceptingId(null);
    }
  };

  const onAcceptRole = async ({ spaceId, requestId }: { spaceId: number; requestId: number }) => {
    setActionError(null);
    try {
      setActingId(`role_accept:${requestId}`);
      await acceptRoleRequest({ spaceId, requestId, token: token! });
      await refresh();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setActionError(apiErr?.error ?? 'Failed to accept role request');
    } finally {
      setActingId(null);
    }
  };

  const onRejectRole = async ({ spaceId, requestId }: { spaceId: number; requestId: number }) => {
    setActionError(null);
    try {
      setActingId(`role_reject:${requestId}`);
      await rejectRoleRequest({ spaceId, requestId, token: token! });
      await refresh();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setActionError(apiErr?.error ?? 'Failed to reject role request');
    } finally {
      setActingId(null);
    }
  };

  if (authLoading) return <p style={{ marginTop: 12 }}>Loading…</p>;
  if (!isAuthenticated) return null;

  return (
    <div style={{ padding: 16, textAlign: 'left' }}>
      <h2>Notifications</h2>

      {(error || actionError) && (
        <p style={{ color: 'red', marginTop: 12 }}>{error ?? actionError}</p>
      )}

      {loading ? <p style={{ marginTop: 12 }}>Loading…</p> : null}

      {!loading && items.length === 0 ? (
        <p style={{ marginTop: 12 }}>No notifications.</p>
      ) : null}

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((n) => {
          if (n.type === 'role_request') {
            const rr = n as RoleRequestNotification;
            return (
              <div
                key={rr.uid}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <p>
                    <strong>{rr.from_username}</strong> is requesting{' '}
                    <strong>{rr.requested_role}</strong> in <strong>{rr.spacename}</strong>
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => void onAcceptRole({ spaceId: rr.space_id, requestId: rr.id })}
                    disabled={actingId === `role_accept:${rr.id}`}
                  >
                    {actingId === `role_accept:${rr.id}` ? 'Accepting…' : 'Accept'}
                  </button>
                  <button
                    onClick={() => void onRejectRole({ spaceId: rr.space_id, requestId: rr.id })}
                    disabled={actingId === `role_reject:${rr.id}`}
                  >
                    {actingId === `role_reject:${rr.id}` ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            );
          }

          // friend_request
          const fr = n as FriendRequestNotification;
          const isPendingIncoming = fr.status === 'pending' && fr.to_user_id === user?.id;
          const otherUsername =
            fr.from_user_id === user?.id ? fr.to_username : fr.from_username;

          return (
            <div
              key={fr.uid}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                {fr.status === 'accepted' ? (
                  <p>{otherUsername} and you are now friends</p>
                ) : (
                  <p>{fr.from_username} sent you a friend request</p>
                )}
              </div>
              {isPendingIncoming ? (
                <button
                  onClick={() => void onAccept(fr.id)}
                  disabled={acceptingId === fr.id}
                >
                  {acceptingId === fr.id ? 'Accepting…' : 'Accept'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
