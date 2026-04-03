import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { acceptFriendRequest, getNotifications } from "../Api";

export default function Notifications() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);

  useEffect(() => {
    if (!user || !token) navigate("/login");
  }, [user, token, navigate]);

  const load = async () => {
    setError(null);
    try {
      setLoading(true);
      const res = await getNotifications({ token });
      setItems(res.data.items || []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && token) load();
  }, [user, token]);

  const onAccept = async (requestId) => {
    setError(null);
    try {
      setAcceptingId(requestId);
      await acceptFriendRequest({ requestId, token });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to accept request");
    } finally {
      setAcceptingId(null);
    }
  };

  if (!user) return null;

  return (
    <div style={{ padding: 16, textAlign: "left" }}>
      <h2>Notifications</h2>

      {error && <p style={{ color: "red", marginTop: 12 }}>{error}</p>}

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
          const isPendingIncoming =
            n.status === "pending" && n.to_user_id === user.id;
          const otherUsername =
            n.from_user_id === user.id ? n.to_username : n.from_username;

          return (
            <div
              key={n.id}
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
                  <p>{otherUsername} and you both are friends</p>
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
