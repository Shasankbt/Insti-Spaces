import { useEffect, useState } from 'react';
import useRequireAuth from '../hooks/useRequireAuth';
import { acceptFriendRequest, acceptRoleRequest, markNotificationsSeen, rejectRoleRequest } from '../Api';
import { useDeltaSync } from '../hooks/useDeltaSync';
import { API_BASE } from '../constants';
import { POLL_INTERVAL } from '../timings';
import type { Notification, FriendRequestNotification, RoleRequestNotification } from '../types';

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86_400) return `${Math.floor(diffSec / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

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

  // Bump notifications_seen_at on first paint of this page. The Navbar's
  // unread-count poll picks up the change on its next tick (and we trigger
  // an immediate re-fetch by virtue of pathname-keyed effect there).
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    void markNotificationsSeen({ token }).catch(() => { /* non-fatal */ });
  }, [isAuthenticated, token]);

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
                  <p
                    className="notification__time"
                    title={new Date(rr.created_at).toLocaleString()}
                  >
                    {formatRelative(rr.created_at)}
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
                <p
                  className="notification__time"
                  title={new Date(fr.created_at).toLocaleString()}
                >
                  {formatRelative(fr.created_at)}
                </p>
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
