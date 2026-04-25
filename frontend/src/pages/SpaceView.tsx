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

type ModalType = 'invite' | 'upload' | 'leave' | 'requestRole' | 'delete' | null;

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
  } = useSpaceView({ id, token, userId: user?.id });

  const [openModal, setOpenModal] = useState<ModalType>(null);
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
    <div>
      <button onClick={() => void navigate('/spaces')}>← Back</button>
      <h2>{space.spacename}</h2>
      <p>Your role: {space.role}</p>

      <div>
        {canInvite && <button onClick={() => setOpenModal('invite')}>Invite</button>}
        {canUpload && <button onClick={() => setOpenModal('upload')}>Upload</button>}
        {canRequestRole && (
          <button onClick={() => setOpenModal('requestRole')}>Request role upgrade</button>
        )}
        {space.role === 'admin' && (
          <button onClick={() => setOpenModal('delete')}>Delete Space</button>
        )}
        <button onClick={() => setOpenModal('leave')}>Leave</button>
      </div>

      <SpaceFeed spaceId={space.id} token={token!} />
      <SpaceExplorer
        space={space}
        token={token!}
        role={space.role}
        refreshTrigger={explorerRefresh}
        onFolderChange={setCurrentFolderId}
      />

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
