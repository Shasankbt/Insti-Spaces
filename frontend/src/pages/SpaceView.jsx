import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  leaveSpace,
  inviteToSpace,
  generateSpaceInviteLink,
  contributeToSpace,
} from "../Api";

// ─── Generic Modal Shell ───────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };
  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        <div className="modal__header">
          <span className="modal__title">{title}</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

// ─── Invite Modal ──────────────────────────────────────────────────────────────
function InviteModal({ space, token, onClose }) {
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
      console.log("df: ", space);
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
    <Modal title={<>Invite to <span className="modal__title-accent">{space.spacename}</span></>} onClose={onClose}>
      <div className="modal__tabs">
        <button className={`modal__tab ${tab === "username" ? "modal__tab--active" : ""}`} onClick={() => setTab("username")}>By Username</button>
        <button className={`modal__tab ${tab === "link" ? "modal__tab--active" : ""}`} onClick={() => setTab("link")}>Invite Link</button>
      </div>

      {tab === "username" && (
        <form onSubmit={handleInvite} className="modal__form">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username…" className="modal__input" />
          <button type="submit" className="modal__btn modal__btn--primary" disabled={inviting || !username.trim()}>
            {inviting ? "Inviting…" : "Send Invite"}
          </button>
          {inviteError && <p className="modal__error">{inviteError}</p>}
          {inviteSuccess && <p className="modal__success">{inviteSuccess}</p>}
        </form>
      )}

      {tab === "link" && (
        <div className="modal__link-panel">
          {!inviteLink ? (
            <button className="modal__btn modal__btn--outline modal__btn--full" onClick={handleGenerateLink} disabled={linkLoading}>
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

// ─── Contribute Modal ──────────────────────────────────────────────────────────
function ContributeModal({ space, token, onClose }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(selected);
    setPreviews(selected.map((f) => URL.createObjectURL(f)));
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleRemove = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) return;
    setUploadError(null);
    setUploadSuccess(null);
    try {
      setUploading(true);
      const formData = new FormData();
      files.forEach((f) => formData.append("photos", f));
      await contributeToSpace({ spaceId: space.id, formData, token });
      setUploadSuccess(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded!`);
      setFiles([]);
      setPreviews([]);
    } catch (err) {
      setUploadError(err.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title={<>Contribute to <span className="modal__title-accent">{space.spacename}</span></>} onClose={onClose}>
      <form onSubmit={handleSubmit} className="modal__contribute-form">
        <div className="modal__dropzone" onClick={() => inputRef.current?.click()}>
          {previews.length === 0 ? (
            <>
              <div className="modal__dropzone-icon">📷</div>
              <p className="modal__dropzone-hint">Click to select photos</p>
            </>
          ) : (
            <div className="modal__previews">
              {previews.map((src, i) => (
                <div key={i} className="modal__preview-wrap">
                  <img src={src} alt="" className="modal__preview-img" />
                  <button type="button" className="modal__preview-remove" onClick={(e) => { e.stopPropagation(); handleRemove(i); }}>✕</button>
                </div>
              ))}
              <div className="modal__preview-add" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>+ Add more</div>
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFileChange} />
        <button type="submit" className="modal__btn modal__btn--primary modal__btn--full" disabled={uploading || files.length === 0}>
          {uploading ? "Uploading…" : `Upload ${files.length > 0 ? `${files.length} Photo${files.length > 1 ? "s" : ""}` : "Photos"}`}
        </button>
        {uploadError && <p className="modal__error">{uploadError}</p>}
        {uploadSuccess && <p className="modal__success">{uploadSuccess}</p>}
      </form>
    </Modal>
  );
}

// ─── Leave Modal ───────────────────────────────────────────────────────────────
function LeaveModal({ space, token, onLeave, onClose }) {
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(null);

  const handleLeave = async () => {
    setLeaveError(null);
    try {
      setLeaving(true);
      await leaveSpace({ spaceId: space.id, token });
      onLeave();
      onClose();
    } catch (err) {
      setLeaveError(err.response?.data?.error || "Failed to leave space");
      setLeaving(false);
    }
  };

  return (
    <Modal title="Leave Space" onClose={onClose}>
      <div className="modal__confirm">
        <p className="modal__confirm-text">
          Are you sure you want to leave <strong className="modal__title-accent">{space.spacename}</strong>?
          {space.role === "admin" && (
            <span className="modal__confirm-warning"> You are the admin — leaving will remove your admin privileges.</span>
          )}
        </p>
        <div className="modal__confirm-actions">
          <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={leaving}>Cancel</button>
          <button className="modal__btn modal__btn--danger" onClick={handleLeave} disabled={leaving}>
            {leaving ? "Leaving…" : "Leave Space"}
          </button>
        </div>
        {leaveError && <p className="modal__error">{leaveError}</p>}
      </div>
    </Modal>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function SpaceView() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [space, setSpace] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (!user || !token) navigate("/login");
  }, [user, token]);

  // fetch space info
  useEffect(() => {
    if (!token) return;
    fetch(`http://localhost:3000/space-view/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setSpace(data.space))
      .catch(() => navigate("/spaces"));
  }, [id, token]);

  // fetch members
  useEffect(() => {
    if (!token) return;
    setMembersLoading(true);
    fetch(`http://localhost:3000/space-view/${id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, [id, token]);

  if (!user || !space) return <p>Loading…</p>;

  return (
    <div>
      <button onClick={() => navigate("/spaces")}>← Back</button>
      <h2>{space.spacename}</h2>
      <p>Your role: {space.role}</p>

      {/* actions */}
      <div>
        {space.role === "admin" && (
          <button onClick={() => setInviteOpen(true)}>Invite</button>
        )}
        {["admin", "moderator", "contributor"].includes(space.role) && (
          <button onClick={() => setContributeOpen(true)}>Contribute</button>
        )}
        <button onClick={() => setLeaveOpen(true)}>Leave</button>
      </div>

      {/* members box */}
      <div style={{ marginTop: "1.5rem" }}>
        <h3>Members</h3>
        {membersLoading && <p>Loading members…</p>}
        {!membersLoading && members.length === 0 && <p>No members found.</p>}
        {members.length > 0 && (
          <div>
            {members.map((m) => (
              <div key={m.userid} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
                <span>{m.username}</span>
                <span style={{ color: "#888", fontSize: "0.85rem" }}>{m.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* modals */}
      {inviteOpen && (
        <InviteModal space={space} token={token} onClose={() => setInviteOpen(false)} />
      )}
      {contributeOpen && (
        <ContributeModal space={space} token={token} onClose={() => setContributeOpen(false)} />
      )}
      {leaveOpen && (
        <LeaveModal
          space={space}
          token={token}
          onLeave={() => navigate("/spaces")}
          onClose={() => setLeaveOpen(false)}
        />
      )}
    </div>
  );
}