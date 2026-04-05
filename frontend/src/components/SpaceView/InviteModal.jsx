import { useState } from "react";
import Modal from "./Modal";
import { inviteToSpace, generateSpaceInviteLink } from "../../Api";

export default function InviteModal({ space, token, onClose }) {
  const [tab, setTab] = useState("username");
  const [username, setUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [inviteSuccess, setInviteSuccess] = useState(null);
  const [inviteLink, setInviteLink] = useState(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

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
    } catch (err) {
      setInviteError(err.response?.data?.error || "Failed to invite");
    } finally {
      setInviting(false);
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
    </Modal>
  );
}
