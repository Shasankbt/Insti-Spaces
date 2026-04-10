import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import useRequireAuth from "../hooks/useRequireAuth";
import { createSpace } from "../Api";
import { useDeltaSync } from "../hooks/useDeltaSync";

export default function Spaces() {
  const { token, loading, isAuthenticated } = useRequireAuth();

  const [activeTab, setActiveTab] = useState("my-spaces");
  const [spacename, setSpacename] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);

  const {
    data: spaces,
    loading: spacesLoading,
    error: spacesError,
    sync,
  } = useDeltaSync("http://localhost:3000/spaces", {
    token,
    interval: 5_000,
    pause: !isAuthenticated || activeTab !== "my-spaces",
  });

  const handleCreate = useCallback(
    async (e) => {
      e.preventDefault();
      setCreateError(null);
      setCreateSuccess(null);
      const clean = spacename.trim();
      if (!clean) return;
      try {
        setCreating(true);
        const res = await createSpace({ spacename: clean, token });
        setCreateSuccess(
          `Space "${res.data.space?.spacename ?? clean}" created!`,
        );
        setSpacename("");
        sync(); // immediate delta pull instead of full reload
      } catch (err) {
        setCreateError(err.response?.data?.error || "Failed to create space");
      } finally {
        setCreating(false);
      }
    },
    [spacename, token, sync],
  );

  if (loading) return <p className="spaces__empty">Loading…</p>;
  if (!isAuthenticated) return null;

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
              {spaces
                .slice()
                .sort((a, b) => a.spacename.localeCompare(b.spacename))
                .map((s) => (
                  <div key={s.id} className="spaces__card">
                    <div>
                      <div className="spaces__card-name">{s.spacename}</div>
                      <div className="spaces__card-role">{s.role}</div>
                    </div>
                    <Link to={`/spaces/${s.id}`} className="spaces__action-btn">
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
