import type { Member, Role } from '../../types';

interface MembersListProps {
  members: Member[];
  loading: boolean;
  currentUserId: number | undefined;
  myRole: Role;
  onRoleChange: (args: { username: string; userId: number; role: Role }) => void;
  onRemoveMember: (args: { userId: number }) => void;
  roleUpdatingUserId: number | null;
  roleUpdateError: string | null;
  removingUserId: number | null;
  removeError: string | null;
}

export default function MembersList({
  members,
  loading,
  currentUserId,
  myRole,
  onRoleChange,
  onRemoveMember,
  roleUpdatingUserId,
  roleUpdateError,
  removingUserId,
  removeError,
}: MembersListProps) {
  const canManage = myRole === 'admin' || myRole === 'moderator';

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3>Members</h3>
      {loading && <p>Loading members…</p>}
      {!loading && members.length === 0 && <p>No members found.</p>}
      {roleUpdateError && <p style={{ color: 'crimson' }}>{roleUpdateError}</p>}
      {removeError && <p style={{ color: 'crimson' }}>{removeError}</p>}
      {members.length > 0 && (
        <div>
          {members.map((m) => {
            const isAdmin = m.role === 'admin';
            const isSelf = m.userid === currentUserId;
            const isUpdating = roleUpdatingUserId === m.userid;
            const isRemoving = removingUserId === m.userid;

            return (
              <div
                key={m.userid}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.4rem 0',
                  borderBottom: '1px solid #eee',
                }}
              >
                <span>
                  {m.username}
                  {isSelf ? ' (you)' : ''}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {canManage && !isAdmin ? (
                    <select
                      value={m.role}
                      disabled={isUpdating}
                      onChange={(e) =>
                        onRoleChange({
                          username: m.username,
                          userId: m.userid,
                          role: e.target.value as Role,
                        })
                      }
                    >
                      <option value="viewer">viewer</option>
                      <option value="contributor">contributor</option>
                      <option value="moderator">moderator</option>
                    </select>
                  ) : (
                    <span style={{ color: '#888', fontSize: '0.85rem' }}>
                      {m.role}
                      {isAdmin ? ' (admin)' : ''}
                    </span>
                  )}
                  {canManage && !isAdmin && !isSelf && (
                    <button
                      onClick={() => onRemoveMember({ userId: m.userid })}
                      disabled={isRemoving}
                      style={{ color: 'crimson', fontSize: '0.8rem' }}
                    >
                      {isRemoving ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
