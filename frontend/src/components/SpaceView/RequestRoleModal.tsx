import { useEffect, useState } from 'react';
import Modal from './Modal';
import { getRoleRequest, requestRole, cancelRoleRequest } from '../../Api';
import type { Space, RoleRequest, Role } from '../../types';

interface RequestRoleModalProps {
  space: Space;
  token: string;
  onClose: () => void;
}

const roleRank: Record<string, number> = { viewer: 1, contributor: 2, moderator: 3 };

export default function RequestRoleModal({ space, token, onClose }: RequestRoleModalProps) {
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<RoleRequest | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentRank = roleRank[space.role] ?? 0;
  const options = (['contributor', 'moderator'] as Role[]).filter(
    (r) => (roleRank[r] ?? 0) > currentRank,
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const res = await getRoleRequest({ spaceId: space.id, token });
        if (mounted) setRequest((res.data as { request?: RoleRequest }).request ?? null);
      } catch (err: unknown) {
        const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
        if (mounted) setError(apiErr?.error ?? 'Failed to load request status');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [space.id, token]);

  const handleSubmit = async () => {
    if (!selectedRole) return;
    setError(null);
    try {
      setSubmitting(true);
      const res = await requestRole({ spaceId: space.id, role: selectedRole, token });
      setRequest((res.data as { request: RoleRequest }).request);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setError(null);
    try {
      setSubmitting(true);
      await cancelRoleRequest({ spaceId: space.id, token });
      setRequest(null);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Failed to cancel request');
    } finally {
      setSubmitting(false);
    }
  };

  const expiresText = request?.expires_at
    ? new Date(request.expires_at).toLocaleString()
    : null;

  return (
    <Modal title="Request Role Upgrade" onClose={onClose}>
      {loading ? (
        <p>Loading…</p>
      ) : request ? (
        <>
          <p className="modal__confirm-text">
            Pending request for <strong>{request.role}</strong>
            {expiresText ? ` (expires ${expiresText})` : ''}.
          </p>
          <div className="modal__confirm-actions" style={{ marginTop: '0.75rem' }}>
            <button className="modal__btn modal__btn--ghost" onClick={onClose} disabled={submitting}>
              Close
            </button>
            <button
              className="modal__btn modal__btn--danger"
              onClick={() => void handleCancel()}
              disabled={submitting}
            >
              {submitting ? 'Cancelling…' : 'Cancel Request'}
            </button>
          </div>
        </>
      ) : options.length === 0 ? (
        <>
          <p className="modal__confirm-text">You already have the highest available role.</p>
          <div className="modal__confirm-actions" style={{ marginTop: '0.75rem' }}>
            <button className="modal__btn modal__btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal__confirm-text">Choose the role you want to request.</p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as Role)}
              disabled={submitting}
            >
              <option value="">Select role…</option>
              {options.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              className="modal__btn modal__btn--primary"
              onClick={() => void handleSubmit()}
              disabled={submitting || !selectedRole}
            >
              {submitting ? 'Requesting…' : 'Submit'}
            </button>
          </div>
          <p className="modal__note" style={{ marginTop: '0.75rem' }}>
            Admins and moderators will review your request.
          </p>
        </>
      )}
      {error && <p className="modal__error">{error}</p>}
    </Modal>
  );
}
