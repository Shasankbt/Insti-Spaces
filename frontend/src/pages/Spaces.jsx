import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getFollowingSpaces, createSpace } from "../Api";

export default function Spaces() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("my-spaces");
  const [spaces, setSpaces] = useState([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [spacesError, setSpacesError] = useState(null);

  const [spacename, setSpacename] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);

  useEffect(() => {
    if (!user || !token) navigate("/login");
  }, [user, token, navigate]);

  const loadSpaces = useCallback(async () => {
    setSpacesError(null);
    try {
      setSpacesLoading(true);
      const res = await getFollowingSpaces({ token });
      setSpaces(res.data.spaces || []);
    } catch (err) {
      setSpacesError(err.response?.data?.error || "Failed to load spaces");
    } finally {
      setSpacesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === "my-spaces") loadSpaces();
  }, [activeTab, loadSpaces]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);
    const clean = spacename.trim();
    if (!clean) return;
    try {
      setCreating(true);
      const res = await createSpace({ spacename: clean, token });
      setCreateSuccess(`Space "${res.data.space?.spacename ?? clean}" created!`);
      setSpacename("");
      loadSpaces();
    } catch (err) {
      setCreateError(err.response?.data?.error || "Failed to create space");
    } finally {
      setCreating(false);
    }
  };

  if (!user) return null;

  return (
    <div className="spaces">
      <div className="spaces__tabs">
        <button
          className={`spaces__tab ${activeTab === "my-spaces" ? "spaces__tab--active" : ""}`}
          onClick={() => setActiveTab("my-spaces")}
        >
          My Spaces
        </button>
        <button
          className={`spaces__tab ${activeTab === "create" ? "spaces__tab--active" : ""}`}
          onClick={() => setActiveTab("create")}
        >
          Create Space
        </button>
      </div>

      {activeTab === "my-spaces" && (
        <div className="spaces__panel">
          {spacesLoading && <p className="spaces__empty">Loading…</p>}
          {spacesError && <p className="spaces__error">{spacesError}</p>}

          {!spacesLoading && !spacesError && spaces.length === 0 && (
            <p className="spaces__empty">
              You're not in any spaces yet.{" "}
              <button
                className="spaces__inline-link"
                onClick={() => setActiveTab("create")}
              >
                Create one!
              </button>
            </p>
          )}

          {spaces.length > 0 && (
            <div className="spaces__list">
              {spaces.map((s) => (
                <div key={s.id} className="spaces__card">
                  <div>
                    <div className="spaces__card-name">{s.spacename}</div>
                    <div className="spaces__card-role">{s.role}</div>
                  </div>
                  {/* just navigate into the space */}
                  <Link
                    to={`/spaces/${s.id}`}
                    className="spaces__action-btn"
                  >
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "create" && (
        <div className="spaces__panel">
          <form onSubmit={handleCreate} className="spaces__form">
            <input
              value={spacename}
              onChange={(e) => setSpacename(e.target.value)}
              placeholder="Space name (e.g. 'Trad Day 2025')"
              className="spaces__input"
              maxLength={50}
            />
            <button type="submit" disabled={creating || !spacename.trim()}>
              {creating ? "Creating…" : "Create"}
            </button>
          </form>
          {createError && <p className="spaces__error">{createError}</p>}
          {createSuccess && <p className="spaces__success">{createSuccess}</p>}
        </div>
      )}
    </div>
  );
}