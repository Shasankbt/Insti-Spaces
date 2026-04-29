import type { Member, Space } from '../../types';

interface SpaceAboutProps {
  space: Space;
  members: Member[];
  onLeave: () => void;
  onDelete?: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export default function SpaceAbout({ space, members, onLeave, onDelete }: SpaceAboutProps) {
  return (
    <div className="space-about">
      <div className="space-about__section">
        <h3 className="space-about__name">{space.spacename}</h3>
        <dl className="space-about__dl">
          <dt>Your role</dt>
          <dd><span className="space-about__role-badge">{space.role}</span></dd>
          <dt>Members</dt>
          <dd>{members.length}</dd>
          {space.created_at && (
            <>
              <dt>Created</dt>
              <dd>{formatDate(space.created_at)}</dd>
            </>
          )}
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
