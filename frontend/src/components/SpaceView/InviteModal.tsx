import { useMemo, useState } from 'react';
import Modal from './Modal';
import { inviteToSpace, generateSpaceInviteLink } from '../../Api';
import { INVITE_ROLES, POLL_INTERVAL } from '../../constants';
import { useDeltaSync } from '../../hooks/useDeltaSync';
import type { Space, Role, Friend, Member } from '../../types';

interface InviteModalProps {
  space: Space;
  token: string;
  members: Member[];
  onClose: () => void;
  onInviteSuccess?: () => void;
}

export default function InviteModal({
  space,
  token,
  members,
  onClose,
  onInviteSuccess,
}: InviteModalProps) {
  const [tab, setTab] = useState<'username' | 'friends' | 'link'>('username');
  const [username, setUsername] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [inviting, setInviting] = useState(false);
  const [invitingFriendId, setInvitingFriendId] = useState<number | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const {
    data: friends,
    loading: friendsLoading,
    error: friendsError,
  } = useDeltaSync<Friend>(`${import.meta.env.VITE_API_URL}/friends`, {
    token,
    interval: POLL_INTERVAL,
    pause: tab !== 'friends',
  });

  const inviteableFriends = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.userid));
    return friends.filter((friend) => !memberIds.has(friend.id));
  }, [friends, members]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = username.trim();
    if (!clean) return;
    setInviteError(null);
    setInviteSuccess(null);
    try {
      setInviting(true);
      await inviteToSpace({ spaceId: space.id, username: clean, role: inviteRole, token });
      setInviteSuccess(`${clean} invited as ${inviteRole}!`);
      setUsername('');
      if (onInviteSuccess) onInviteSuccess();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setInviteError(apiErr?.error ?? 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

  const handleInviteFriend = async (friend: Friend) => {
    setInviteError(null);
    setInviteSuccess(null);
    try {
      setInvitingFriendId(friend.id);
      await inviteToSpace({ spaceId: space.id, userId: friend.id, role: inviteRole, token });
      setInviteSuccess(`${friend.username} invited as ${inviteRole}!`);
      if (onInviteSuccess) onInviteSuccess();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setInviteError(apiErr?.error ?? 'Failed to invite');
    } finally {
      setInvitingFriendId(null);
    }
  };

  const handleGenerateLink = async () => {
    setLinkError(null);
    setLinkCopied(false);
    try {
      setLinkLoading(true);
      const res = await generateSpaceInviteLink({ spaceId: space.id, token });
      setInviteLink((res.data as { inviteLink: string }).inviteLink);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setLinkError(apiErr?.error ?? 'Failed to generate link');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopy = () => {
  if (!inviteLink) return;

  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(inviteLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  } else {
    // Fallback for non-HTTPS / local IP access
    const el = document.createElement('textarea');
    el.value = inviteLink;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  }
};

  return (
    <Modal
      title={
        <>
          Invite to <span className="modal__title-accent">{space.spacename}</span>
        </>
      }
      onClose={onClose}
    >
      <div className="modal__tabs">
        <button
          className={`modal__tab ${tab === 'username' ? 'modal__tab--active' : ''}`}
          onClick={() => setTab('username')}
        >
          By Username
        </button>
        <button
          className={`modal__tab ${tab === 'friends' ? 'modal__tab--active' : ''}`}
          onClick={() => setTab('friends')}
        >
          Friends
        </button>
        <button
          className={`modal__tab ${tab === 'link' ? 'modal__tab--active' : ''}`}
          onClick={() => setTab('link')}
        >
          Invite Link
        </button>
      </div>

      {tab === 'username' && (
        <form onSubmit={(e) => void handleInvite(e)} className="modal__form">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username…"
            className="modal__input"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="modal__input"
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="modal__btn modal__btn--primary"
            disabled={inviting || !username.trim()}
          >
            {inviting ? 'Inviting…' : 'Send Invite'}
          </button>
          {inviteError && <p className="modal__error">{inviteError}</p>}
          {inviteSuccess && <p className="modal__success">{inviteSuccess}</p>}
        </form>
      )}

      {tab === 'friends' && (
        <div className="modal__friends-panel">
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="modal__input"
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {friendsLoading && <p className="modal__empty">Loading friends…</p>}
          {friendsError && <p className="modal__error">{friendsError}</p>}
          {!friendsLoading && !friendsError && inviteableFriends.length === 0 && (
            <p className="modal__empty">No friends to invite yet.</p>
          )}
          {inviteableFriends.length > 0 && (
            <div className="modal__friends-list">
              {inviteableFriends.map((friend) => (
                <div key={friend.id} className="modal__friend-row">
                  <div>
                    <div className="modal__friend-name">{friend.username}</div>
                    <div className="modal__friend-meta">Friend</div>
                  </div>
                  <button
                    type="button"
                    className="modal__btn modal__btn--primary"
                    onClick={() => void handleInviteFriend(friend)}
                    disabled={invitingFriendId !== null}
                  >
                    {invitingFriendId === friend.id ? 'Inviting…' : 'Invite'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {inviteError && <p className="modal__error">{inviteError}</p>}
          {inviteSuccess && <p className="modal__success">{inviteSuccess}</p>}
        </div>
      )}

      {tab === 'link' && (
        <div className="modal__link-panel">
          {!inviteLink ? (
            <button
              className="modal__btn modal__btn--outline modal__btn--full"
              onClick={() => void handleGenerateLink()}
              disabled={linkLoading}
            >
              {linkLoading ? 'Generating…' : 'Generate Invite Link'}
            </button>
          ) : (
            <div className="modal__link-box">
              <span className="modal__link-text">{inviteLink}</span>
              <button className="modal__btn modal__btn--primary" onClick={handleCopy}>
                {linkCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
          {linkError && <p className="modal__error">{linkError}</p>}
          <p className="modal__note">Anyone with this link can join the space as viewer.</p>
        </div>
      )}
    </Modal>
  );
}
