export default function MembersList({ members, loading, currentUserId, myRole, onRoleChange, roleUpdatingUserId, roleUpdateError }) {
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Members</h3>
      {loading && <p>Loading members…</p>}
      {!loading && members.length === 0 && <p>No members found.</p>}
      {roleUpdateError && <p style={{ color: "crimson" }}>{roleUpdateError}</p>}
      {members.length > 0 && (
        <div>
          {members.map((m) => (
            <div
              key={m.userid}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.4rem 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <span>{m.username}</span>
              {myRole === "admin" ? (
                <select
                  value={m.role}
                  disabled={roleUpdatingUserId === m.userid || (m.role === "admin" && m.userid !== currentUserId)}
                  onChange={(e) => onRoleChange({ username: m.username, userId: m.userid, role: e.target.value })}
                >
                  <option value="viewer">viewer</option>
                  <option value="contributor">contributor</option>
                  <option value="moderator">moderator</option>
                  <option value="admin">admin{m.userid === currentUserId ? " (you)" : ""}</option>
                </select>
              ) : (
                <span style={{ color: "#888", fontSize: "0.85rem" }}>{m.role}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
