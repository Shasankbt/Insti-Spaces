import { useEffect, useMemo, useRef, useState } from 'react';
import type { Member, Role } from '../../types';
import { TOAST_DURATION_MS } from '../../timings';
import { IconChangeRole, IconRemoveUser } from './Icons';
import Modal from './Modal';

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
  onInvite?: () => void;
  onRequestRole?: () => void;
}

const ROLE_OPTIONS: Role[] = ['viewer', 'contributor', 'moderator'];

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
  onInvite,
  onRequestRole,
}: MembersListProps) {
  const canManage = myRole === 'admin' || myRole === 'moderator';
  const [query, setQuery] = useState('');
  const [roleEditMember, setRoleEditMember] = useState<Member | null>(null);
  const [pendingRole, setPendingRole] = useState<Role>('viewer');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (roleEditMember && roleUpdatingUserId === null) {
      const stillStale = members.find((m) => m.userid === roleEditMember.userid);
      if (stillStale && stillStale.role !== roleEditMember.role) {
        setRoleEditMember(null);
      }
    }
  }, [members, roleEditMember, roleUpdatingUserId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.username.toLowerCase().includes(q) || m.role.toLowerCase().includes(q),
    );
  }, [members, query]);

  return (
    <div className="members-list">
      <div className="members-list__search-row">
        <input
          type="search"
          className="members-list__search"
          placeholder="Search members…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {onInvite && (
          <button
            type="button"
            className="members-list__invite-btn"
            onClick={onInvite}
          >
            Invite members
          </button>
        )}
        {onRequestRole && (
          <button
            type="button"
            className="members-list__invite-btn members-list__invite-btn--ghost"
            onClick={onRequestRole}
          >
            Request role upgrade
          </button>
        )}
      </div>

      {loading && <p>Loading members…</p>}
      {!loading && members.length === 0 && <p>No members found.</p>}
      {!loading && members.length > 0 && filtered.length === 0 && (
        <p className="members-list__empty">No members match "{query}".</p>
      )}
      {roleUpdateError && <p className="members-list__error">{roleUpdateError}</p>}
      {removeError && <p className="members-list__error">{removeError}</p>}

      {filtered.length > 0 && (
        <div className="members-list__grid">
          {filtered.map((m) => {
            const isAdmin = m.role === 'admin';
            const isSelf = m.userid === currentUserId;
            const isUpdating = roleUpdatingUserId === m.userid;
            const isRemoving = removingUserId === m.userid;
            const canEditThis = canManage && !isAdmin;
            const canRemoveThis = canManage && !isAdmin && !isSelf;

            return (
              <div key={m.userid} className="member-row">
                <span className="member-row__name">
                  {m.username}
                  {isSelf ? ' (you)' : ''}
                </span>
                <span className="member-row__meta">
                  <span className="member-row__dot" aria-hidden="true">•</span>
                  <span className="member-row__role">
                    {m.role}
                    {isAdmin ? ' (admin)' : ''}
                  </span>
                </span>

                <div className="member-row__actions">
                  <button
                    type="button"
                    className={`member-row__icon-btn${canEditThis ? '' : ' member-row__icon-btn--disabled'}`}
                    aria-label="Change role"
                    title="Change role"
                    disabled={isUpdating}
                    onClick={() => {
                      if (!canEditThis) {
                        showToast(
                          isAdmin
                            ? "You can't change an admin's role."
                            : isSelf
                              ? "You can't change your own role."
                              : 'You have to be a moderator or admin to change roles.',
                        );
                        return;
                      }
                      setPendingRole(m.role);
                      setRoleEditMember(m);
                    }}
                  >
                    <IconChangeRole />
                  </button>

                  <button
                    type="button"
                    className={`member-row__icon-btn member-row__icon-btn--danger${canRemoveThis ? '' : ' member-row__icon-btn--disabled'}`}
                    aria-label="Remove user"
                    title="Remove user"
                    disabled={isRemoving}
                    onClick={() => {
                      if (!canRemoveThis) {
                        showToast(
                          isAdmin
                            ? "You can't remove an admin."
                            : isSelf
                              ? "You can't remove yourself."
                              : 'You have to be a moderator or admin to remove users.',
                        );
                        return;
                      }
                      onRemoveMember({ userId: m.userid });
                    }}
                  >
                    <IconRemoveUser />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="members-list__toast">{toast}</div>}

      {roleEditMember && (
        <Modal title="Change role" onClose={() => setRoleEditMember(null)}>
          <div className="role-modal">
            <p className="role-modal__user">
              <span className="role-modal__label">User:</span>{' '}
              <strong>{roleEditMember.username}</strong>
            </p>
            <label className="role-modal__field">
              <span className="role-modal__label">Role</span>
              <select
                className="role-modal__select"
                value={pendingRole}
                onChange={(e) => setPendingRole(e.target.value as Role)}
                disabled={roleUpdatingUserId === roleEditMember.userid}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <div className="role-modal__actions">
              <button
                type="button"
                className="role-modal__btn role-modal__btn--ghost"
                onClick={() => setRoleEditMember(null)}
                disabled={roleUpdatingUserId === roleEditMember.userid}
              >
                Cancel
              </button>
              <button
                type="button"
                className="role-modal__btn role-modal__btn--primary"
                disabled={
                  pendingRole === roleEditMember.role ||
                  roleUpdatingUserId === roleEditMember.userid
                }
                onClick={() =>
                  onRoleChange({
                    username: roleEditMember.username,
                    userId: roleEditMember.userid,
                    role: pendingRole,
                  })
                }
              >
                {roleUpdatingUserId === roleEditMember.userid ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
