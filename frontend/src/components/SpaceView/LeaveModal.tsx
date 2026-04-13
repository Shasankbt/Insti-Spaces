import { useState } from 'react';
import Modal from './Modal';
import { leaveSpace } from '../../Api';
import type { Space, Member } from '../../types';

interface LeaveModalProps {
  space: Space;
  token: string;
  members: Member[];
  currentUserId: number | undefined;
  onLeave: () => void;
  onClose: () => void;
}

export default function LeaveModal({
  space,
  token,
  members,
  currentUserId,
  onLeave,
  onClose,
}: LeaveModalProps) {
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const isAdmin = space.role === 'admin';
  const otherMembers = members.filter((m) => m.userid !== currentUserId);
  const isOnlyMember = otherMembers.length === 0;

  // Admin with other members cannot leave — show block message immediately.
  if (isAdmin && !isOnlyMember) {
    return (
      <Modal title="Leave Space" onClose={onClose}>
        <div className="modal__confirm">
          <p className="modal__confirm-text">
            The admin cannot leave{' '}
            <strong className="modal__title-accent">{space.spacename}</strong> while other members
            exist. Remove all members first or delete the space.
          </p>
          <div className="modal__confirm-actions" style={{ marginTop: '0.75rem' }}>
            <button className="modal__btn modal__btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const handleLeave = async () => {
    setLeaveError(null);
    try {
      setLeaving(true);
      await leaveSpace({ spaceId: space.id, token });
      onLeave();
      onClose();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { message?: string; error?: string } } })
        .response?.data;
      setLeaveError(apiErr?.message ?? apiErr?.error ?? 'Failed to leave space');
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Modal title="Leave Space" onClose={onClose}>
      <div className="modal__confirm">
        {isAdmin && isOnlyMember ? (
          <>
            <p className="modal__confirm-text">
              You are the only member. Leaving will delete{' '}
              <strong className="modal__title-accent">{space.spacename}</strong>.
            </p>
            <div className="modal__confirm-actions">
              <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={leaving}>
                Cancel
              </button>
              <button
                className="modal__btn modal__btn--danger"
                onClick={() => void handleLeave()}
                disabled={leaving}
              >
                {leaving ? 'Leaving…' : 'Confirm Leave'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal__confirm-text">
              Are you sure you want to leave{' '}
              <strong className="modal__title-accent">{space.spacename}</strong>?
            </p>
            <div className="modal__confirm-actions">
              <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={leaving}>
                Cancel
              </button>
              <button
                className="modal__btn modal__btn--danger"
                onClick={() => void handleLeave()}
                disabled={leaving}
              >
                {leaving ? 'Leaving…' : 'Leave Space'}
              </button>
            </div>
          </>
        )}
        {leaveError && <p className="modal__error">{leaveError}</p>}
      </div>
    </Modal>
  );
}
