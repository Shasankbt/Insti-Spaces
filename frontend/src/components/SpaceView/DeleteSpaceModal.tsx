import { useState } from 'react';
import Modal from './Modal';
import { deleteSpace } from '../../Api';
import type { Space } from '../../types';

interface DeleteSpaceModalProps {
  space: Space;
  token: string;
  onDeleted: () => void;
  onClose: () => void;
}

export default function DeleteSpaceModal({
  space,
  token,
  onDeleted,
  onClose,
}: DeleteSpaceModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    try {
      setDeleting(true);
      await deleteSpace({ spaceId: space.id, token });
      onDeleted();
      onClose();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Failed to delete space');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Delete Space" onClose={onClose}>
      <p className="modal__confirm-text">
        This will permanently delete{' '}
        <strong className="modal__title-accent">{space.spacename}</strong> and all its photos. This
        cannot be undone.
      </p>
      <div className="modal__confirm-actions" style={{ marginTop: '0.75rem' }}>
        <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={deleting}>
          Cancel
        </button>
        <button
          className="modal__btn modal__btn--danger"
          onClick={() => void handleDelete()}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete Space'}
        </button>
      </div>
      {error && <p className="modal__error">{error}</p>}
    </Modal>
  );
}
