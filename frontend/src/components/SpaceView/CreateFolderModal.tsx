import { useState } from 'react';
import Modal from './Modal';
import { createSpaceFolder } from '../../Api';
import type { Space } from '../../types';

interface CreateFolderModalProps {
  space: Space;
  token: string;
  parentId?: number | null;
  onCreated: () => void;
  onClose: () => void;
}

export default function CreateFolderModal({
  space,
  token,
  parentId = null,
  onCreated,
  onClose,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      setLoading(true);
      await createSpaceFolder({ spaceId: space.id, name: name.trim(), parentId, token });
      onCreated();
      onClose();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Failed to create folder');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <>
          New folder in <span className="modal__title-accent">{space.spacename}</span>
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <input
          type="text"
          placeholder="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={100}
        />
        <button
          type="submit"
          className="modal__btn modal__btn--primary modal__btn--full"
          disabled={loading || !name.trim()}
        >
          {loading ? 'Creating…' : 'Create folder'}
        </button>
        {error && <p className="modal__error">{error}</p>}
      </form>
    </Modal>
  );
}
