import { useCallback, useEffect, useState } from 'react';
import {
  createSpaceInviteLink,
  listSpaceInviteLinks,
  revokeSpaceInviteLink,
  type InviteLinkRow,
} from '../../Api';
import { INVITE_ROLES } from '../../constants';
import { COPY_CONFIRM_DURATION_MS, POLL_INTERVAL } from '../../timings';
import type { Role, Space } from '../../types';

interface SpaceInviteLinksProps {
  space: Space;
  token: string;
  /** True when this tab is the currently-visible one. Drives the poll. */
  active: boolean;
}

type ExpiryPreset = '1d' | '7d' | '30d' | 'never' | 'custom';

const PRESET_LABEL: Record<ExpiryPreset, string> = {
  '1d':    '1 day',
  '7d':    '7 days',
  '30d':   '30 days',
  never:   'Never',
  custom:  'Custom…',
};

const presetToIso = (preset: ExpiryPreset, customIso: string | null): string | null | undefined => {
  switch (preset) {
    case '1d':   return new Date(Date.now() + 1  * 86_400_000).toISOString();
    case '7d':   return new Date(Date.now() + 7  * 86_400_000).toISOString();
    case '30d':  return undefined; // server's default — keeps the SQL `NOW() + INTERVAL '30 days'` path
    case 'never': return null;
    case 'custom': return customIso;
  }
};

const formatDate = (iso: string | null): string => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return 'never expires';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) return 'expired';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 3600)   return `expires in ${Math.max(1, Math.floor(diffSec / 60))}m`;
  if (diffSec < 86400)  return `expires in ${Math.floor(diffSec / 3600)}h`;
  return `expires in ${Math.floor(diffSec / 86400)}d`;
};

const truncateToken = (t: string): string =>
  t.length <= 12 ? t : `${t.slice(0, 4)}…${t.slice(-4)}`;

const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
};

export default function SpaceInviteLinks({ space, token, active }: SpaceInviteLinksProps) {
  const canManage = space.role === 'admin' || space.role === 'moderator';

  const [links, setLinks] = useState<InviteLinkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Form state for the create-link panel.
  const [role, setRole] = useState<Role>('viewer');
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('30d');
  const [customExpiry, setCustomExpiry] = useState('');
  const [singleUse, setSingleUse] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canManage) return;
    try {
      const { data } = await listSpaceInviteLinks({ spaceId: space.id, token });
      setLinks(data.links);
      setListError(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to load invite links';
      setListError(msg);
    }
  }, [canManage, space.id, token]);

  // Initial load + poll while the tab is active.
  useEffect(() => {
    if (!active || !canManage) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    const id = window.setInterval(() => { void refresh(); }, POLL_INTERVAL);
    return () => window.clearInterval(id);
  }, [active, canManage, refresh]);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setCreateError(null);

    let expiresAt: string | null | undefined;
    if (expiryPreset === 'custom') {
      if (!customExpiry) {
        setCreateError('Pick a custom date or choose a preset');
        return;
      }
      const d = new Date(customExpiry);
      if (Number.isNaN(d.getTime())) {
        setCreateError('Invalid date');
        return;
      }
      if (d.getTime() <= Date.now()) {
        setCreateError('Custom expiry must be in the future');
        return;
      }
      expiresAt = d.toISOString();
    } else {
      expiresAt = presetToIso(expiryPreset, null);
    }

    setCreating(true);
    try {
      await createSpaceInviteLink({
        spaceId: space.id,
        role,
        expiresAt,
        singleUse,
        token,
      });
      await refresh();
      // Reset form back to friendly defaults.
      setSingleUse(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to create invite link';
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (link: InviteLinkRow): Promise<void> => {
    if (!window.confirm(`Revoke this ${link.role} invite link? Anyone holding it will no longer be able to join.`)) return;
    setRevokingId(link.id);
    try {
      await revokeSpaceInviteLink({ spaceId: space.id, linkId: link.id, token });
      await refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to revoke invite link';
      setListError(msg);
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopy = async (link: InviteLinkRow): Promise<void> => {
    try {
      await copyToClipboard(link.inviteLink);
      setCopiedId(link.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === link.id ? null : current));
      }, COPY_CONFIRM_DURATION_MS);
    } catch {
      window.alert('Failed to copy link');
    }
  };

  if (!canManage) {
    return (
      <div className="invite-links">
        <p className="invite-links__locked">
          Only admins and moderators can manage invite links.
        </p>
      </div>
    );
  }

  return (
    <div className="invite-links">
      {/* ── Create panel ── */}
      <section className="invite-links__create">
        <h3 className="invite-links__heading">New invite link</h3>
        <form onSubmit={(e) => void handleCreate(e)} className="invite-links__form">
          <label className="invite-links__field">
            <span className="invite-links__label">Role</span>
            <select
              className="invite-links__select"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>

          <label className="invite-links__field">
            <span className="invite-links__label">Expires</span>
            <select
              className="invite-links__select"
              value={expiryPreset}
              onChange={(e) => setExpiryPreset(e.target.value as ExpiryPreset)}
            >
              {(['1d', '7d', '30d', 'never', 'custom'] as ExpiryPreset[]).map((p) => (
                <option key={p} value={p}>{PRESET_LABEL[p]}</option>
              ))}
            </select>
          </label>

          {expiryPreset === 'custom' && (
            <label className="invite-links__field">
              <span className="invite-links__label">Custom date</span>
              <input
                type="datetime-local"
                className="invite-links__input"
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value)}
              />
            </label>
          )}

          <label className="invite-links__field invite-links__field--inline">
            <input
              type="checkbox"
              checked={singleUse}
              onChange={(e) => setSingleUse(e.target.checked)}
            />
            <span className="invite-links__label">Single-use (revokes after first accept)</span>
          </label>

          <button
            type="submit"
            className="invite-links__create-btn"
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create link'}
          </button>
          {createError && <p className="invite-links__error">{createError}</p>}
        </form>
      </section>

      {/* ── Active links list ── */}
      <section className="invite-links__list-section">
        <h3 className="invite-links__heading">
          Active links {links.length > 0 && <span className="invite-links__count">({links.length})</span>}
        </h3>

        {loading && links.length === 0 && <p className="invite-links__hint">Loading…</p>}
        {listError && <p className="invite-links__error">{listError}</p>}
        {!loading && !listError && links.length === 0 && (
          <p className="invite-links__hint">No active invite links. Create one above.</p>
        )}

        {links.length > 0 && (
          <ul className="invite-links__list">
            {links.map((link) => (
              <li key={link.id} className="invite-links__row">
                <div className="invite-links__row-main">
                  <div className="invite-links__row-line">
                    <span className={`invite-links__role-pill invite-links__role-pill--${link.role}`}>
                      {link.role}
                    </span>
                    {link.single_use && (
                      <span className="invite-links__tag">single-use</span>
                    )}
                    <code className="invite-links__token" title={link.token}>
                      {truncateToken(link.token)}
                    </code>
                  </div>
                  <div className="invite-links__row-meta">
                    <span title={formatDate(link.expires_at)}>{formatRelative(link.expires_at)}</span>
                    <span className="invite-links__sep">·</span>
                    <span title={new Date(link.created_at).toLocaleString()}>
                      created {new Date(link.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="invite-links__row-actions">
                  <button
                    type="button"
                    className="invite-links__btn"
                    onClick={() => void handleCopy(link)}
                  >
                    {copiedId === link.id ? 'Copied!' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    className="invite-links__btn invite-links__btn--danger"
                    onClick={() => void handleRevoke(link)}
                    disabled={revokingId === link.id}
                  >
                    {revokingId === link.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
