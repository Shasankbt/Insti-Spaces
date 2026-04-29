import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useRequireAuth from '../hooks/useRequireAuth';
import useSpaceView from '../hooks/useSpaceView';
import MembersList from '../components/SpaceView/MembersList';
import InviteModal from '../components/SpaceView/InviteModal';
import UploadModal from '../components/SpaceView/UploadModal';
import LeaveModal from '../components/SpaceView/LeaveModal';
import RequestRoleModal from '../components/SpaceView/RequestRoleModal';
import DeleteSpaceModal from '../components/SpaceView/DeleteSpaceModal';
import SpaceFeed from '../components/SpaceView/SpaceFeed';
import SpaceExplorer from '../components/SpaceView/SpaceExplorer';
import SpaceTrash from '../components/SpaceView/SpaceTrash';
import SpaceAbout from '../components/SpaceView/SpaceAbout';

type ModalType = 'invite' | 'upload' | 'leave' | 'requestRole' | 'delete' | null;
type TabType = 'feed' | 'explorer' | 'members' | 'trash' | 'about';

const TABS: { key: TabType; label: string }[] = [
  { key: 'feed', label: 'feed' },
  { key: 'explorer', label: 'explorer' },
  { key: 'members', label: 'members' },
  { key: 'trash', label: 'trash' },
  { key: 'about', label: 'ⓘ' },
];

export default function SpaceView() {
  const { id } = useParams<{ id: string }>();
  const { user, token, loading, isAuthenticated } = useRequireAuth();
  const navigate = useNavigate();

  const {
    space,
    spaceLoading,
    spaceError,
    members,
    membersLoading,
    roleUpdatingUserId,
    roleUpdateError,
    removingUserId,
    removeError,
    handleRoleChange,
    handleRemoveMember,
    fetchMembers,
  } = useSpaceView({ id, token });

  const [openModal, setOpenModal] = useState<ModalType>(null);
  const [activeTab, setActiveTab] = useState<TabType>('feed');
  const [explorerRefresh, setExplorerRefresh] = useState(0);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) return;
    if (spaceLoading) return;
    if (spaceError) void navigate('/spaces', { replace: true });
  }, [isAuthenticated, loading, spaceLoading, spaceError, navigate]);

  if (loading) return <p>Loading…</p>;
  if (!isAuthenticated) return null;
  if (spaceLoading) return <p>Loading…</p>;
  if (spaceError) return null;
  if (!space) return <p>Loading…</p>;

  const canInvite = ['admin', 'moderator'].includes(space.role);
  const canRequestRole = ['viewer', 'contributor'].includes(space.role);
  const canUpload = ['admin', 'moderator', 'contributor'].includes(space.role);

  return (
    <div className="space-view">
      <div className="space-view__top">
        <button className="space-view__back" onClick={() => void navigate('/spaces')}>← Back</button>
        <h2 className="space-view__title">{space.spacename}</h2>
      </div>

      <nav className="space-tabs" aria-label="Space sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`space-tab${activeTab === tab.key ? ' space-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="space-view__content">
        {activeTab === 'feed' && (
          <SpaceFeed spaceId={space.id} token={token!} />
        )}

        {activeTab === 'explorer' && (
          <SpaceExplorer
            space={space}
            token={token!}
            role={space.role}
            refreshTrigger={explorerRefresh}
            onFolderChange={setCurrentFolderId}
            onUpload={canUpload ? () => setOpenModal('upload') : undefined}
          />
        )}

        {activeTab === 'members' && (
          <div className="space-members-tab">
            <div className="space-members-tab__actions">
              {canInvite && (
                <button onClick={() => setOpenModal('invite')}>Invite members</button>
              )}
              {canRequestRole && (
                <button onClick={() => setOpenModal('requestRole')}>Request role upgrade</button>
              )}
            </div>
            <MembersList
              members={members}
              loading={membersLoading}
              currentUserId={user?.id}
              myRole={space.role}
              onRoleChange={handleRoleChange}
              onRemoveMember={handleRemoveMember}
              roleUpdatingUserId={roleUpdatingUserId}
              roleUpdateError={roleUpdateError}
              removingUserId={removingUserId}
              removeError={removeError}
            />
          </div>
        )}

        {activeTab === 'trash' && (
          <SpaceTrash space={space} token={token!} role={space.role} />
        )}

        {activeTab === 'about' && (
          <SpaceAbout
            space={space}
            members={members}
            onLeave={() => setOpenModal('leave')}
            onDelete={space.role === 'admin' ? () => setOpenModal('delete') : undefined}
          />
        )}
      </div>

      {openModal === 'invite' && (
        <InviteModal
          space={space}
          token={token!}
          members={members}
          onInviteSuccess={() => void fetchMembers()}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === 'upload' && (
        <UploadModal
          space={space}
          token={token!}
          folderId={currentFolderId}
          onClose={() => setOpenModal(null)}
          onUploadSuccess={() => setExplorerRefresh((n) => n + 1)}
        />
      )}
      {openModal === 'leave' && (
        <LeaveModal
          space={space}
          token={token!}
          members={members}
          currentUserId={user?.id}
          onLeave={() => void navigate('/spaces')}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === 'requestRole' && (
        <RequestRoleModal space={space} token={token!} onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'delete' && (
        <DeleteSpaceModal
          space={space}
          token={token!}
          onDeleted={() => void navigate('/spaces')}
          onClose={() => setOpenModal(null)}
        />
      )}
    </div>
  );
}
