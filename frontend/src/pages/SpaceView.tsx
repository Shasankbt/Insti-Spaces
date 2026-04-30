import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import SpaceHashCleanup from '../components/SpaceView/SpaceHashCleanup';
import SpaceAbout from '../components/SpaceView/SpaceAbout';

type ModalType = 'invite' | 'upload' | 'leave' | 'requestRole' | 'delete' | null;

interface ResumableUploadSummary {
  sessionId: string;
  uploadedCount: number;
  totalCount: number;
  pendingCount: number;
  message: string;
}

type TabType = 'feed' | 'explorer' | 'members' | 'trash' | 'duplicates' | 'similars' | 'about';

const PRIMARY_TABS: { key: Extract<TabType, 'feed' | 'explorer' | 'members'>; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'members', label: 'Members' },
];

const CLEANUP_TABS: { key: Extract<TabType, 'trash' | 'duplicates' | 'similars' | 'about'>; label: string }[] = [
  { key: 'trash', label: 'Trash' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'similars', label: 'Similars' },
  { key: 'about', label: 'About' },
];

export default function SpaceView() {
  const { id, '*': folderPath = '' } = useParams<{ id: string; '*': string }>();
  const { user, token, loading, isAuthenticated } = useRequireAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [explorerRefresh, setExplorerRefresh] = useState(0);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [resumableUpload, setResumableUpload] = useState<ResumableUploadSummary | null>(null);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [resumeSignal, setResumeSignal] = useState(0);
  const [cleanupMenuOpen, setCleanupMenuOpen] = useState(false);
  const menuShellRef = useRef<HTMLDivElement>(null);
  const requestedTab = searchParams.get('tab');
  const activeTab: TabType = [...PRIMARY_TABS, ...CLEANUP_TABS].some((tab) => tab.key === requestedTab)
    ? (requestedTab as TabType)
    : folderPath
      ? 'explorer'
      : 'feed';

  const setActiveTab = (tab: TabType) => {
    setCleanupMenuOpen(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'feed') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    }, { replace: true });
  };
  const [visitedTabs, setVisitedTabs] = useState<Set<TabType>>(() => new Set([activeTab]));

  useEffect(() => {
    if (!cleanupMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuShellRef.current && !menuShellRef.current.contains(e.target as Node)) {
        setCleanupMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [cleanupMenuOpen]);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) return;
    if (spaceLoading) return;
    if (spaceError) void navigate('/spaces', { replace: true });
  }, [isAuthenticated, loading, spaceLoading, spaceError, navigate]);

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  if (loading) return <p>Loading…</p>;
  if (!isAuthenticated) return null;
  if (spaceLoading) return <p>Loading…</p>;
  if (spaceError) return null;
  if (!space) return <p>Loading…</p>;

  const canInvite = ['admin', 'moderator'].includes(space.role);
  const canRequestRole = ['viewer', 'contributor'].includes(space.role);
  const canUpload = ['admin', 'moderator', 'contributor'].includes(space.role);
  const handleResumeUpload = () => {
    setOpenModal('upload');
    setResumeSignal((count) => count + 1);
  };

  return (
    <div className="space-view">
      <button onClick={() => void navigate('/spaces')}>← Back</button>

      {resumableUpload && (
        <div className="space-view__upload-resume-banner">
          <div>
            <p className="space-view__upload-resume-title">Upload paused</p>
            <p className="space-view__upload-resume-copy">{resumableUpload.message}</p>
          </div>
          <button
            type="button"
            className="space-view__upload-resume-btn"
              onClick={() => handleResumeUpload()}
          >
            Resume upload
          </button>
        </div>
      )}

      <div className="space-view__tabs-row">
        <nav className="space-tabs" aria-label="Space sections">
          {PRIMARY_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`space-tab${activeTab === tab.key ? ' space-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="space-view__menu-shell" ref={menuShellRef}>
          <button
            type="button"
            className={`space-view__menu-btn${cleanupMenuOpen || CLEANUP_TABS.some((tab) => tab.key === activeTab) ? ' space-view__menu-btn--active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={cleanupMenuOpen}
            title="Cleanup sections"
            onClick={() => setCleanupMenuOpen((prev) => !prev)}
          >
            ☰
          </button>

          {cleanupMenuOpen && (
            <div className="space-view__menu" role="menu" aria-label="Cleanup sections">
              {CLEANUP_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`space-view__menu-item${activeTab === tab.key ? ' space-view__menu-item--active' : ''}`}
                  role="menuitem"
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-view__content">
        {visitedTabs.has('feed') && (
          <div className="space-view__tab-panel" hidden={activeTab !== 'feed'}>
            <SpaceFeed spaceId={space.id} token={token!} active={activeTab === 'feed'} />
          </div>
        )}

        {visitedTabs.has('explorer') && (
          <div className="space-view__tab-panel" hidden={activeTab !== 'explorer'}>
            <SpaceExplorer
              space={space}
              token={token!}
              role={space.role}
              refreshTrigger={explorerRefresh}
              onFolderChange={setCurrentFolderId}
              onUpload={canUpload ? () => setOpenModal('upload') : undefined}
            />
          </div>
        )}

        {visitedTabs.has('members') && (
          <div className="space-view__tab-panel space-members-tab" hidden={activeTab !== 'members'}>
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
              onInvite={canInvite ? () => setOpenModal('invite') : undefined}
              onRequestRole={canRequestRole ? () => setOpenModal('requestRole') : undefined}
            />
          </div>
        )}

        {visitedTabs.has('trash') && (
          <div className="space-view__tab-panel" hidden={activeTab !== 'trash'}>
            <SpaceTrash space={space} token={token!} role={space.role} />
          </div>
        )}

        {visitedTabs.has('duplicates') && (
          <div className="space-view__tab-panel" hidden={activeTab !== 'duplicates'}>
            <SpaceHashCleanup space={space} token={token!} mode="duplicates" />
          </div>
        )}

        {visitedTabs.has('similars') && (
          <div className="space-view__tab-panel" hidden={activeTab !== 'similars'}>
            <SpaceHashCleanup space={space} token={token!} mode="similars" />
          </div>
        )}

        {visitedTabs.has('about') && (
          <div className="space-view__tab-panel" hidden={activeTab !== 'about'}>
            <SpaceAbout
              space={space}
              onLeave={() => setOpenModal('leave')}
              onDelete={space.role === 'admin' ? () => setOpenModal('delete') : undefined}
            />
          </div>
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
          initialFiles={pendingUploadFiles}
          onClose={() => {
            setOpenModal(null);
          }}
          onItemsCommitted={() => setExplorerRefresh((n) => n + 1)}
          onResumableUploadChange={setResumableUpload}
          onPendingFilesChange={setPendingUploadFiles}
          resumeSignal={resumeSignal}
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
