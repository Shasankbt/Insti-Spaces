import { useState } from "react";
import Modal from "./Modal";
import { leaveSpace } from "../../Api";

export default function LeaveModal({ space, token, members, currentUserId, onLeave, onClose }) {
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(null);
  const [mode, setMode] = useState("confirm");

  const isOnlyMember = (members || []).filter((m) => m.userid !== currentUserId).length === 0;

  const handleLeave = async () => {
    setLeaveError(null);
    try {
      setLeaving(true);
      await leaveSpace({ spaceId: space.id, token });
      onLeave();
      onClose();
    } catch (err) {
      const apiErr = err.response?.data;
      if (apiErr?.error === "last_admin") {
        setMode("last_admin");
        setLeaveError(apiErr?.message || "You are the only admin. Promote another member before leaving.");
      } else {
        setLeaveError(apiErr?.error || "Failed to leave space");
      }
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Modal title="Leave Space" onClose={onClose}>
      <div className="modal__confirm">
        {mode === "confirm" && (
          <>
            <p className="modal__confirm-text">
              Are you sure you want to leave{" "}
              <strong className="modal__title-accent">{space.spacename}</strong>?
              {space.role === "admin" && (
                <span className="modal__confirm-warning">
                  {" "}You are the admin — leaving will remove your admin privileges.
                </span>
              )}
            </p>
            <div className="modal__confirm-actions">
              <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={leaving}>
                Cancel
              </button>
              <button className="modal__btn modal__btn--danger" onClick={handleLeave} disabled={leaving}>
                {leaving ? "Leaving…" : "Leave Space"}
              </button>
            </div>
          </>
        )}

        {mode === "last_admin" && (
          <>
            {isOnlyMember ? (
              <>
                <p className="modal__confirm-text">
                  You are the only member. Leaving will delete{" "}
                  <strong className="modal__title-accent">{space.spacename}</strong>.
                </p>
                <div className="modal__confirm-actions">
                  <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={leaving}>
                    Cancel
                  </button>
                  <button className="modal__btn modal__btn--danger" onClick={handleLeave} disabled={leaving}>
                    {leaving ? "Leaving…" : "Confirm Leave"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal__confirm-text">
                  You are the only admin. Promote another member to admin from the Members list, then try leaving again.
                </p>
                <div className="modal__confirm-actions" style={{ marginTop: "0.75rem" }}>
                  <button className="modal__btn modal__btn--ghost" onClick={onClose}>Close</button>
                </div>
              </>
            )}
          </>
        )}

        {leaveError && <p className="modal__error">{leaveError}</p>}
      </div>
    </Modal>
  );
}
