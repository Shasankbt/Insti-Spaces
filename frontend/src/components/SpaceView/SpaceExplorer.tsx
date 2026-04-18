import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { downloadSelected, getSpaceExplorer } from '../../Api';
import { useDeltaSync } from '../../hooks/useDeltaSync';
import type { ExplorerFolder, Role, Space, SpaceItem } from '../../types';
import CreateFolderModal from './CreateFolderModal';

const API_BASE = 'http://localhost:3000';
const POLL_INTERVAL = 10_000;

interface SpaceExplorerProps {
  space: Space;
  token: string;
  role: Role;
  refreshTrigger?: number;
  onFolderChange?: (folderId: number | null) => void;
}

const toAbsoluteUrl = (url: string): string =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `${API_BASE}${url}`;

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const canWrite = (role: Role) => ['contributor', 'moderator', 'admin'].includes(role);

interface DeltaItem extends SpaceItem {
  updated_at: string;
  deleted: boolean;
}

interface DeltaFolder {
  id: number;
  name: string;
  parent_id: number | null;
  space_id: number;
  updated_at: string;
  deleted: boolean;
}

export default function SpaceExplorer({
  space,
  token,
  role,
  refreshTrigger,
  onFolderChange,
}: SpaceExplorerProps) {
  const { '*': folderPath = '' } = useParams<{ '*': string }>();
  const navigate = useNavigate();

  const [breadcrumbs, setBreadcrumbs] = useState<ExplorerFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<ExplorerFolder | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DeltaItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(new Set());

  const toggleSelectMode = () => {
    setSelectMode((prev) => {
      if (prev) {
        setSelectedItemIds(new Set());
        setSelectedFolderIds(new Set());
      }
      return !prev;
    });
  };

  const toggleItemId = (id: string) =>
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleFolderId = (id: number) =>
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const totalSelected = selectedItemIds.size + selectedFolderIds.size;

  const handleDownload = () => {
    void downloadSelected({
      spaceId: space.id,
      token,
      itemIds: [...selectedItemIds],
      folderIds: [...selectedFolderIds],
    });
  };

  const currentFolderIdRef = useRef<number | null>(null);

  const itemsUrl = `${API_BASE}/spaces/${space.id}/items${
    currentFolderIdRef.current != null ? `?folder_id=${currentFolderIdRef.current}` : ''
  }`;

  const {
    data: items,
    loading: itemsLoading,
    error: itemsError,
    refresh: refreshItems,
  } = useDeltaSync<DeltaItem>(itemsUrl, {
    token,
    interval: POLL_INTERVAL,
    idKey: 'itemId',
  });

  const {
    data: allFolders,
    refresh: refreshFolders,
  } = useDeltaSync<DeltaFolder>(`${API_BASE}/spaces/${space.id}/folders`, {
    token,
    interval: POLL_INTERVAL,
    idKey: 'id',
  });

  const subfolders = allFolders.filter((f) => f.parent_id === (currentFolder?.id ?? null));

  const resolveMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const { data } = await getSpaceExplorer({
        spaceId: space.id,
        token,
        path: folderPath || undefined,
      });
      setBreadcrumbs(data.breadcrumbs);
      setCurrentFolder(data.currentFolder);
      const newFolderId = data.currentFolder?.id ?? null;
      currentFolderIdRef.current = newFolderId;
      onFolderChange?.(newFolderId);
    } catch {
      setMetaError('Folder not found');
    } finally {
      setMetaLoading(false);
    }
  }, [space.id, token, folderPath, onFolderChange]);

  const isMountMeta = useRef(true);
  useEffect(() => {
    void resolveMeta();
  }, [resolveMeta]);

  useEffect(() => {
    if (isMountMeta.current) {
      isMountMeta.current = false;
      return;
    }
    void refreshItems();
    void refreshFolders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath]);

  const isMountRefresh = useRef(true);
  useEffect(() => {
    if (isMountRefresh.current) {
      isMountRefresh.current = false;
      return;
    }
    void refreshItems();
  }, [refreshTrigger, refreshItems]);

  // Close dropdown on outside click
  useEffect(() => {
    if (openMenuId == null) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  useEffect(() => {
    if (lightboxIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      else if (e.key === 'ArrowLeft')
        setLightboxIndex((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
      else if (e.key === 'ArrowRight')
        setLightboxIndex((prev) =>
          prev == null ? prev : Math.min(items.length - 1, prev + 1),
        );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, items.length]);

  const navigateToFolder = (folder: DeltaFolder) => {
    const segments = [
      ...breadcrumbs.map((b) => encodeURIComponent(b.name)),
      ...(currentFolder ? [encodeURIComponent(currentFolder.name)] : []),
      encodeURIComponent(folder.name),
    ];
    navigate(`/spaces/${space.id}/${segments.join('/')}`);
  };

  const navigateToBreadcrumb = (index: number) => {
    const segments = breadcrumbs
      .slice(0, index + 1)
      .map((b) => encodeURIComponent(b.name));
    navigate(`/spaces/${space.id}/${segments.join('/')}`);
  };

  const navigateToRoot = () => navigate(`/spaces/${space.id}`);

  const activeItem = lightboxIndex == null ? null : (items[lightboxIndex] ?? null);
  const hasPrev = lightboxIndex != null && lightboxIndex > 0;
  const hasNext = lightboxIndex != null && lightboxIndex < items.length - 1;

  const loading = metaLoading || itemsLoading;
  const error = metaError ?? itemsError;
  const isEmpty = subfolders.length === 0 && items.length === 0;

  return (
    <section className="space-explorer">
      <div className="space-explorer__header">
        <h3 className="space-explorer__title">Explorer</h3>
        <div className="space-explorer__header-actions">
          {canWrite(role) && !selectMode && (
            <button onClick={() => setShowNewFolder(true)}>New Folder</button>
          )}
          {selectMode && totalSelected > 0 && (
            <button onClick={handleDownload}>Download ({totalSelected})</button>
          )}
          <button onClick={toggleSelectMode}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
          {!selectMode && (
            <button onClick={() => { void refreshItems(); void refreshFolders(); }} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      <nav className="space-explorer__breadcrumb" aria-label="folder path">
        <button type="button" className="space-explorer__breadcrumb-item" onClick={navigateToRoot}>
          🏠
        </button>
        {breadcrumbs.map((crumb, i) => (
          <>
            <span key={`sep-${crumb.id}`} className="space-explorer__breadcrumb-sep">/</span>
            <button
              key={crumb.id}
              type="button"
              className="space-explorer__breadcrumb-item"
              onClick={() => navigateToBreadcrumb(i)}
            >
              {crumb.name}
            </button>
          </>
        ))}
        {currentFolder && (
          <>
            <span className="space-explorer__breadcrumb-sep">/</span>
            <span className="space-explorer__breadcrumb-item space-explorer__breadcrumb-item--current">
              {currentFolder.name}
            </span>
          </>
        )}
      </nav>

      {loading && isEmpty && <p className="space-explorer__message">Loading…</p>}
      {error && <p className="space-explorer__message space-explorer__message--error">{error}</p>}
      {!loading && !error && isEmpty && (
        <p className="space-explorer__message">This folder is empty.</p>
      )}

      <div className="space-explorer__body">
        {(subfolders.length > 0 || items.length > 0) && (
          <div className="space-explorer__grid">
            {subfolders.map((folder) => (
              <div
                key={`folder-${folder.id}`}
                className={`space-explorer__tile-wrap${selectedFolderIds.has(folder.id) ? ' space-explorer__tile-wrap--selected' : ''}`}
              >
                <button
                  type="button"
                  className="space-explorer__tile space-explorer__tile--folder"
                  onClick={() => selectMode ? toggleFolderId(folder.id) : navigateToFolder(folder)}
                  title={folder.name}
                >
                  {selectMode && (
                    <span className="space-explorer__select-check">
                      {selectedFolderIds.has(folder.id) ? '☑' : '☐'}
                    </span>
                  )}
                  <span className="space-explorer__folder-icon">📁</span>
                  <span className="space-explorer__folder-name">{folder.name}</span>
                </button>
              </div>
            ))}

            {items.map((item, index) => (
              <div key={item.itemId} className={`space-explorer__tile-wrap${selectedItemIds.has(item.itemId) ? ' space-explorer__tile-wrap--selected' : ''}`}>
                {/* Image container — overflow:hidden stays here only */}
                <div className="space-explorer__tile--item">
                  {selectMode && (
                    <span className="space-explorer__select-check">
                      {selectedItemIds.has(item.itemId) ? '☑' : '☐'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="space-explorer__tile-btn"
                    onClick={() => selectMode ? toggleItemId(item.itemId) : setLightboxIndex(index)}
                    title={item.displayName}
                  >
                    <img
                      src={toAbsoluteUrl(item.thumbnailUrl)}
                      alt={item.displayName}
                      loading="lazy"
                      className="space-explorer__thumb"
                    />
                  </button>
                </div>

                {/* ⋮ button lives outside overflow:hidden */}
                <button
                  type="button"
                  className="space-explorer__menu-btn"
                  aria-label="Item options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId !== item.itemId ? item.itemId : null);
                  }}
                >
                  ⋮
                </button>

                {openMenuId === item.itemId && (
                  <div className="space-explorer__menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="space-explorer__menu-item">Copy link</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => {
                        setOpenMenuId(null);
                        void downloadSelected({ spaceId: space.id, token, itemIds: [item.itemId], folderIds: [] });
                      }}
                    >Download</button>
                    <button type="button" className="space-explorer__menu-item">Rename</button>
                    <button type="button" className="space-explorer__menu-item">Move to folder</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { setSelectedItem(item); setOpenMenuId(null); }}
                    >
                      Get details
                    </button>
                    <hr className="space-explorer__menu-divider" />
                    <button type="button" className="space-explorer__menu-item space-explorer__menu-item--danger">
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {selectedItem && (
          <aside className="space-explorer__info-panel">
            <button
              type="button"
              className="space-explorer__info-close"
              onClick={() => setSelectedItem(null)}
              aria-label="Close info panel"
            >
              ✕
            </button>
            <img
              src={toAbsoluteUrl(selectedItem.thumbnailUrl)}
              alt={selectedItem.displayName}
              className="space-explorer__info-thumb"
            />
            <h4 className="space-explorer__info-name">{selectedItem.displayName}</h4>
            <dl className="space-explorer__info-dl">
              <dt>Type</dt>
              <dd>{selectedItem.mimeType}</dd>
              <dt>Uploaded</dt>
              <dd>{formatDate(selectedItem.uploadedAt)}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(selectedItem.sizeBytes)}</dd>
            </dl>
          </aside>
        )}
      </div>

      {activeItem && (
        <div
          className="space-explorer__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={activeItem.displayName}
          onClick={() => setLightboxIndex(null)}
        >
          <div className="space-explorer__lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="space-explorer__lightbox-close"
              onClick={() => setLightboxIndex(null)}
              aria-label="Close"
            >
              ✕
            </button>
            <div className="space-explorer__lightbox-stage">
              <button
                type="button"
                className="space-explorer__lightbox-hit space-explorer__lightbox-hit--prev"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
                }}
                disabled={!hasPrev}
                aria-label="Previous"
              />
              <button
                type="button"
                className="space-explorer__lightbox-hit space-explorer__lightbox-hit--next"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) =>
                    prev == null ? prev : Math.min(items.length - 1, prev + 1),
                  );
                }}
                disabled={!hasNext}
                aria-label="Next"
              />
              {isVideoMime(activeItem.mimeType) ? (
                <video
                  src={toAbsoluteUrl(activeItem.fileUrl)}
                  className="space-explorer__lightbox-video"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={toAbsoluteUrl(activeItem.fileUrl)}
                  alt={activeItem.displayName}
                  className="space-explorer__lightbox-image"
                />
              )}
            </div>
            <p className="space-explorer__lightbox-name">{activeItem.displayName}</p>
          </div>
        </div>
      )}

      {showNewFolder && (
        <CreateFolderModal
          space={space}
          token={token}
          parentId={currentFolder?.id ?? null}
          onCreated={() => void refreshFolders()}
          onClose={() => setShowNewFolder(false)}
        />
      )}
    </section>
  );
}
