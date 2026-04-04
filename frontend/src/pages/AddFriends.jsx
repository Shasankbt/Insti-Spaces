import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { createFriendRequest, searchUsers, getFriends } from "../Api";

export default function AddFriends() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("friends"); // "friends" | "search"

  // --- My Friends state ---
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);

  // --- Search state ---
  const [prefix, setPrefix] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    if (!user || !token) navigate("/login");
  }, [user, token, navigate]);

  const loadFriends = useCallback(async () => {
    setFriendsError(null);
    try {
      setFriendsLoading(true);
      const res = await getFriends({ token });
      setFriends(res.data.friends || []);
    } catch (err) {
      setFriendsError(err.response?.data?.error || "Failed to load friends");
    } finally {
      setFriendsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === "friends") loadFriends();
  }, [activeTab, loadFriends]);

  const handleSearch = async (e) => {
    e.preventDefault();
    setSearchError(null);

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
      setSearchError(err.response?.data?.error || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (toUserId) => {
    setSearchError(null);
    try {
      setAddingId(toUserId);
      await createFriendRequest({ toUserId, token });
      setResults((prev) =>
        prev.map((u) =>
          u.id === toUserId ? { ...u, relationship: "pending" } : u,
        ),
      );
    } catch (err) {
      setSearchError(
        err.response?.data?.error || "Failed to send friend request",
      );
    } finally {
      setAddingId(null);
    }
  };

  if (!user) return null;

  return (
    <div className="add-friends">
      {/* Tab Bar */}
      <div className="add-friends__tabs">
        <button
          className={`add-friends__tab ${activeTab === "friends" ? "add-friends__tab--active" : ""}`}
          onClick={() => setActiveTab("friends")}
        >
          My Friends
        </button>
        <button
          className={`add-friends__tab ${activeTab === "search" ? "add-friends__tab--active" : ""}`}
          onClick={() => setActiveTab("search")}
        >
          Add Friends
        </button>
      </div>

      {/* My Friends Tab */}
      {activeTab === "friends" && (
        <div className="add-friends__panel">
          {friendsLoading && <p className="add-friends__empty">Loading…</p>}
          {friendsError && <p className="add-friends__error">{friendsError}</p>}

          {!friendsLoading && !friendsError && friends.length === 0 && (
            <p className="add-friends__empty">
              You have no friends yet. Search and add some!
            </p>
          )}

          {friends.length > 0 && (
            <div className="add-friends__list">
              {friends.map((f) => (
                <div key={f.id} className="add-friends__user-card">
                  <div>
                    <div className="add-friends__username">{f.username}</div>
                    <div className="add-friends__status">Friends</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search / Add Friends Tab */}
      {activeTab === "search" && (
        <div className="add-friends__panel">
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

          {searchError && <p className="add-friends__error">{searchError}</p>}

          <div className="add-friends__results">
            {results.length === 0 && prefix.trim() && !loading ? (
              <p className="add-friends__empty">No users found.</p>
            ) : null}

            {results.length > 0 && (
              <div className="add-friends__list">
                {results.map((u) => (
                  <div key={u.id} className="add-friends__user-card">
                    <div>
                      <div className="add-friends__username">{u.username}</div>
                      {u.relationship === "friends" && (
                        <div className="add-friends__status">Friends</div>
                      )}
                      {u.relationship === "pending" && (
                        <div className="add-friends__status">
                          Request pending
                        </div>
                      )}
                    </div>

                    {u.relationship === "none" && (
                      <button
                        onClick={() => handleAdd(u.id)}
                        disabled={addingId === u.id}
                      >
                        {addingId === u.id ? "Adding…" : "Add"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
