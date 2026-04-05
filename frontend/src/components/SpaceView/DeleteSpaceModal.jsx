import { useState } from "react";
import Modal from "./Modal";
import { deleteSpace } from "../../Api";

export default function DeleteSpaceModal({ space, token, onDeleted, onClose }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    setError(null);
    try {
      setDeleting(true);
      await deleteSpace({ spaceId: space.id, token });
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete space");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Delete Space" onClose={onClose}>
      <p className="modal__confirm-text">
        This will permanently delete{" "}
        <strong className="modal__title-accent">{space.spacename}</strong> and all its photos. This cannot be undone.
      </p>
      <div className="modal__confirm-actions" style={{ marginTop: "0.75rem" }}>
        <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={deleting}>
          Cancel
        </button>
        <button className="modal__btn modal__btn--danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete Space"}
        </button>
      </div>
      {error && <p className="modal__error">{error}</p>}
    </Modal>
  );
}
