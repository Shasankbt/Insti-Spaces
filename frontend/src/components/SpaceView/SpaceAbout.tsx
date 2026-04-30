import { useEffect, useState } from 'react';
import { getSpaceStorage } from '../../Api';
import type { Space } from '../../types';

interface SpaceAboutProps {
  space: Space;
  token: string;
  /** True when the About tab is the active tab. Drives the lazy storage fetch. */
  active: boolean;
  onLeave: () => void;
  onDelete?: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export default function SpaceAbout({ space, token, active, onLeave, onDelete }: SpaceAboutProps) {
  const [storage, setStorage] = useState<number | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStorageLoading(true);
    getSpaceStorage({ spaceId: space.id, token })
      .then(({ data }) => { if (!cancelled) setStorage(data.totalStorageBytes); })
      .catch(() => { if (!cancelled) setStorage(null); })
      .finally(() => { if (!cancelled) setStorageLoading(false); });
    return () => { cancelled = true; };
  }, [active, space.id, token]);

  return (
    <div className="space-about">
      <div className="space-about__section">
        <h3 className="space-about__name">{space.spacename}</h3>
        <dl className="space-about__dl">
          {space.owner_username && (
            <>
              <dt>Created by</dt>
              <dd>@{space.owner_username}</dd>
            </>
          )}
          {space.created_at && (
            <>
              <dt>Created on</dt>
              <dd title={new Date(space.created_at).toLocaleString()}>
                {new Date(space.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              </dd>
            </>
          )}
          <dt>Storage used</dt>
          <dd>
            {storage !== null
              ? formatBytes(storage)
              : storageLoading ? 'computing…' : '—'}
          </dd>
        </dl>
      </div>

      <div className="space-about__danger-zone">
        <h4 className="space-about__danger-title">Danger zone</h4>
        <div className="space-about__danger-actions">
          <button className="space-about__btn space-about__btn--leave" onClick={onLeave}>
            Leave space
          </button>
          {onDelete && (
            <button className="space-about__btn space-about__btn--delete" onClick={onDelete}>
              Delete space
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
