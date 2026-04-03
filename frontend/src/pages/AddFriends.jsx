import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { createFriendRequest, searchUsers } from "../Api";
import "./AddFriends.css";

export default function AddFriends() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [prefix, setPrefix] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    if (!user || !token) navigate("/login");
  }, [user, token, navigate]);

  const handleSearch = async (e) => {
    e.preventDefault();
    setError(null);

    const clean = prefix.trim();
    if (!clean) {
      setResults([]);
      return;
    }

    try {
      setLoading(true);
      const res = await searchUsers({ prefix: clean, token });
      setResults(res.data.users || []);
    } catch (err) {
      setError(err.response?.data?.error || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (toUserId) => {
    setError(null);
    try {
      setAddingId(toUserId);
      await createFriendRequest({ toUserId, token });
      setResults((prev) =>
        prev.map((u) =>
          u.id === toUserId ? { ...u, relationship: "pending" } : u,
        ),
      );
    } catch (err) {
      setError(err.response?.data?.error || "Failed to send friend request");
    } finally {
      setAddingId(null);
    }
  };

  if (!user) return null;

  return (
    <div className="add-friends">
      <h2 className="add-friends__title">Add Friends</h2>

      <form onSubmit={handleSearch} className="add-friends__form">
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="Search username prefix (e.g. 'ni')"
          className="add-friends__input"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="add-friends__error">{error}</p>}

      <div className="add-friends__results">
        {results.length === 0 && prefix.trim() ? (
          <p className="add-friends__empty">No users found.</p>
        ) : null}

        {results.length > 0 ? (
          <div className="add-friends__list">
            {results.map((u) => (
              <div key={u.id} className="add-friends__user-card">
                <div>
                  <div className="add-friends__username">{u.username}</div>
                  {u.relationship === "friends" ? (
                    <div className="add-friends__status">Friends</div>
                  ) : null}
                  {u.relationship === "pending" ? (
                    <div className="add-friends__status">Request pending</div>
                  ) : null}
                </div>

                {u.relationship === "none" ? (
                  <button
                    onClick={() => handleAdd(u.id)}
                    disabled={addingId === u.id}
                  >
                    {addingId === u.id ? "Adding…" : "Add"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
