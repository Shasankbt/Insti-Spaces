import type { Space } from '../../types';

interface SpaceAboutProps {
  space: Space;
  onLeave: () => void;
  onDelete?: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export default function SpaceAbout({ space, onLeave, onDelete }: SpaceAboutProps) {
  return (
    <div className="space-about">
      <div className="space-about__section">
        <h3 className="space-about__name">{space.spacename}</h3>
        <dl className="space-about__dl">
          <dt>Storage used</dt>
          <dd>{formatBytes(space.totalStorageBytes ?? 0)}</dd>
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
