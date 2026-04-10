import useRequireAuth from "../hooks/useRequireAuth";
import {
  acceptFriendRequest,
  acceptRoleRequest,
  rejectRoleRequest,
} from "../Api";
import { useDeltaSync } from "../hooks/useDeltaSync";
import { useState } from "react";

export default function Notifications() {
  const {
    user,
    token,
    loading: authLoading,
    isAuthenticated,
  } = useRequireAuth();

  const {
    data: items,
    loading,
    error,
    refresh,
  } = useDeltaSync("http://localhost:3000/user/notifications", {
    token,
    interval: 5_000,
    pause: !isAuthenticated,
    idKey: "uid",
  });

  const [acceptingId, setAcceptingId] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const onAccept = async (requestId) => {
    setActionError(null);
    try {
      setAcceptingId(requestId);
      await acceptFriendRequest({ requestId, token });
      await refresh();
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to accept request");
    } finally {
      setAcceptingId(null);
    }
  };

  const onAcceptRole = async ({ spaceId, requestId }) => {
    setActionError(null);
    try {
      setActingId(`role_accept:${requestId}`);
      await acceptRoleRequest({ spaceId, requestId, token });
      await refresh();
    } catch (err) {
      setActionError(
        err.response?.data?.error || "Failed to accept role request",
      );
    } finally {
      setActingId(null);
    }
  };

  const onRejectRole = async ({ spaceId, requestId }) => {
    setActionError(null);
    try {
      setActingId(`role_reject:${requestId}`);
      await rejectRoleRequest({ spaceId, requestId, token });
      await refresh();
    } catch (err) {
      setActionError(
        err.response?.data?.error || "Failed to reject role request",
      );
    } finally {
      setActingId(null);
    }
  };

  if (authLoading) return <p style={{ marginTop: 12 }}>Loading…</p>;
  if (!isAuthenticated) return null;

  return (
    <div style={{ padding: 16, textAlign: "left" }}>
      <h2>Notifications</h2>

      {(error || actionError) && (
        <p style={{ color: "red", marginTop: 12 }}>{error || actionError}</p>
      )}

      {loading ? <p style={{ marginTop: 12 }}>Loading…</p> : null}

      {!loading && items.length === 0 ? (
        <p style={{ marginTop: 12 }}>No notifications.</p>
      ) : null}

      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {items.map((n) => {
          if (n.type === "role_request") {
            return (
              <div
                key={n.uid}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <p>
                    <strong>{n.from_username}</strong> is requesting{" "}
                    <strong>{n.requested_role}</strong> in{" "}
                    <strong>{n.spacename}</strong>
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() =>
                      onAcceptRole({ spaceId: n.space_id, requestId: n.id })
                    }
                    disabled={actingId === `role_accept:${n.id}`}
                  >
                    {actingId === `role_accept:${n.id}`
                      ? "Accepting…"
                      : "Accept"}
                  </button>
                  <button
                    onClick={() =>
                      onRejectRole({ spaceId: n.space_id, requestId: n.id })
                    }
                    disabled={actingId === `role_reject:${n.id}`}
                  >
                    {actingId === `role_reject:${n.id}`
                      ? "Rejecting…"
                      : "Reject"}
                  </button>
                </div>
              </div>
            );
          }

          // friend_request
          const isPendingIncoming =
            n.status === "pending" && n.to_user_id === user.id;
          const otherUsername =
            n.from_user_id === user.id ? n.to_username : n.from_username;

          return (
            <div
              key={n.uid}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                {n.status === "accepted" ? (
                  <p>{otherUsername} and you are now friends</p>
                ) : (
                  <p>{n.from_username} sent you a friend request</p>
                )}
              </div>

              {isPendingIncoming ? (
                <button
                  onClick={() => onAccept(n.id)}
                  disabled={acceptingId === n.id}
                >
                  {acceptingId === n.id ? "Accepting…" : "Accept"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
