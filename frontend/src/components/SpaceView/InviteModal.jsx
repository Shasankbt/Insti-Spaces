import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { getFriends, inviteToSpace, generateSpaceInviteLink } from "../../Api";

export default function InviteModal({ space, token, members = [], onClose, onInviteSuccess }) {
  const [tab, setTab] = useState("username");
  const [username, setUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invitingFriendId, setInvitingFriendId] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [inviteSuccess, setInviteSuccess] = useState(null);
  const [inviteLink, setInviteLink] = useState(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadFriends = async () => {
      try {
        setFriendsLoading(true);
        setFriendsError(null);
        const res = await getFriends({ token });
        if (!mounted) return;
        setFriends(res.data.friends || []);
      } catch (err) {
        if (!mounted) return;
        setFriendsError(err.response?.data?.error || "Failed to load friends");
      } finally {
        if (mounted) setFriendsLoading(false);
      }
    };

    loadFriends();
    return () => {
      mounted = false;
    };
  }, [token]);

  const memberIds = useMemo(
    () => new Set((members || []).map((member) => member.userid)),
    [members],
  );

  const invitableFriends = useMemo(
    () => friends.filter((friend) => !memberIds.has(friend.id)),
    [friends, memberIds],
  );

  const handleInvite = async (e) => {
    e.preventDefault();
    const clean = username.trim();
    if (!clean) return;
    setInviteError(null);
    setInviteSuccess(null);
    try {
      setInviting(true);
      await inviteToSpace({ spaceId: space.id, username: clean, token });
      setInviteSuccess(`${clean} invited!`);
      setUsername("");
      if (onInviteSuccess) onInviteSuccess();
    } catch (err) {
      setInviteError(err.response?.data?.error || "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const handleInviteFriend = async (friend) => {
    setInviteError(null);
    setInviteSuccess(null);
    try {
      setInvitingFriendId(friend.id);
      await inviteToSpace({ spaceId: space.id, userId: friend.id, token });
      setFriends((prev) => prev.filter((item) => item.id !== friend.id));
      setInviteSuccess(`${friend.username} invited!`);
      if (onInviteSuccess) onInviteSuccess();
    } catch (err) {
      setInviteError(err.response?.data?.error || "Failed to invite");
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
      setInviteLink(res.data.inviteLink);
    } catch (err) {
      setLinkError(err.response?.data?.error || "Failed to generate link");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopy = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  };

  return (
    <Modal
      title={<>Invite to <span className="modal__title-accent">{space.spacename}</span></>}
      onClose={onClose}
    >
      <div className="modal__tabs">
        <button
          className={`modal__tab ${tab === "username" ? "modal__tab--active" : ""}`}
          onClick={() => setTab("username")}
        >
          By Username
        </button>
        <button
          className={`modal__tab ${tab === "link" ? "modal__tab--active" : ""}`}
          onClick={() => setTab("link")}
        >
          Invite Link
        </button>
        <button
          className={`modal__tab ${tab === "friends" ? "modal__tab--active" : ""}`}
          onClick={() => setTab("friends")}
        >
          My Friends
        </button>
      </div>

      {tab === "username" && (
        <form onSubmit={handleInvite} className="modal__form">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username…"
            className="modal__input"
          />
          <button
            type="submit"
            className="modal__btn modal__btn--primary"
            disabled={inviting || !username.trim()}
          >
            {inviting ? "Inviting…" : "Send Invite"}
          </button>
          {inviteError && <p className="modal__error">{inviteError}</p>}
          {inviteSuccess && <p className="modal__success">{inviteSuccess}</p>}
        </form>
      )}

      {tab === "link" && (
        <div className="modal__link-panel">
          {!inviteLink ? (
            <button
              className="modal__btn modal__btn--outline modal__btn--full"
              onClick={handleGenerateLink}
              disabled={linkLoading}
            >
              {linkLoading ? "Generating…" : "Generate Invite Link"}
            </button>
          ) : (
            <div className="modal__link-box">
              <span className="modal__link-text">{inviteLink}</span>
              <button className="modal__btn modal__btn--primary" onClick={handleCopy}>
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
          {linkError && <p className="modal__error">{linkError}</p>}
          <p className="modal__note">Anyone with this link can join the space.</p>
        </div>
      )}

      {tab === "friends" && (
        <div className="modal__link-panel">
          {friendsLoading && <p className="modal__note">Loading friends…</p>}
          {friendsError && <p className="modal__error">{friendsError}</p>}
          {!friendsLoading && !friendsError && invitableFriends.length === 0 && (
            <p className="modal__note">All of your current friends are already in this space.</p>
          )}
          {!friendsLoading && invitableFriends.length > 0 && (
            <div className="add-friends__list">
              {invitableFriends.map((friend) => (
                <div key={friend.id} className="add-friends__user-card">
                  <div>
                    <div className="add-friends__username">{friend.username}</div>
                    <div className="add-friends__status">Friend</div>
                  </div>
                  <button
                    className="modal__btn modal__btn--primary"
                    onClick={() => handleInviteFriend(friend)}
                    disabled={invitingFriendId === friend.id}
                  >
                    {invitingFriendId === friend.id ? "Inviting…" : "Invite"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {inviteError && <p className="modal__error">{inviteError}</p>}
          {inviteSuccess && <p className="modal__success">{inviteSuccess}</p>}
        </div>
      )}
    </Modal>
  );
}
