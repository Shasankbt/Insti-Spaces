export default function MembersList({
  members,
  loading,
  currentUserId,
  ownerUserId,
  myRole,
  onRoleChange,
  onRemoveMember,
  onTransferOwnership,
  roleUpdatingUserId,
  memberActionUserId,
  roleUpdateError,
  memberActionError,
}) {
  const isCurrentUserOwner = ownerUserId === currentUserId;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Members</h3>
      {loading && <p>Loading members…</p>}
      {!loading && members.length === 0 && <p>No members found.</p>}
      {roleUpdateError && <p style={{ color: "crimson" }}>{roleUpdateError}</p>}
      {memberActionError && <p style={{ color: "crimson" }}>{memberActionError}</p>}
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
              <span>
                {m.username}
                {m.userid === currentUserId ? " (you)" : ""}
                {m.is_owner ? " • main admin" : ""}
              </span>
              {myRole === "admin" ? (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <select
                    value={m.role}
                    disabled={roleUpdatingUserId === m.userid || memberActionUserId === m.userid || m.is_owner}
                    onChange={(e) => onRoleChange({ username: m.username, userId: m.userid, role: e.target.value })}
                  >
                    <option value="viewer">viewer</option>
                    <option value="contributor">contributor</option>
                    <option value="moderator">moderator</option>
                    <option value="admin">admin</option>
                  </select>
                  {isCurrentUserOwner && m.role === "admin" && !m.is_owner && (
                    <button
                      onClick={() => onTransferOwnership({ userId: m.userid })}
                      disabled={memberActionUserId === m.userid}
                    >
                      {memberActionUserId === m.userid ? "Transferring…" : "Make Main Admin"}
                    </button>
                  )}
                  {!m.is_owner && m.userid !== currentUserId && (
                    <button
                      onClick={() => onRemoveMember({ userId: m.userid })}
                      disabled={memberActionUserId === m.userid || roleUpdatingUserId === m.userid}
                    >
                      {memberActionUserId === m.userid ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
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
