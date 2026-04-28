import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  copyItems,
  downloadSelected,
  emptySpaceTrash,
  getSpaceExplorer,
  getSpaceTrash,
  moveItems,
  permanentlyDeleteSpaceTrashItem,
  renameSpaceItem,
  restoreSpaceTrashItem,
  trashItems as trashItemsApi,
} from '../../Api';
import type { ConflictResolution, ItemConflict } from '../../Api';
import { useDeltaSync } from '../../hooks/useDeltaSync';
import type { ExplorerFolder, Role, Space, SpaceItem } from '../../types';
import { AuthenticatedImage, AuthenticatedVideo } from './AuthenticatedMedia';
import CreateFolderModal from './CreateFolderModal';
import Modal from './Modal';
import { API_BASE, EXPLORER_PAGE_SIZE, POLL_INTERVAL, TRASH_LIMIT } from '../../constants';
import { itemFileUrl, itemThumbnailUrl } from '../../utils';

interface SpaceExplorerProps {
  space: Space;
  token: string;
  role: Role;
  refreshTrigger?: number;
  onFolderChange?: (folderId: number | null) => void;
}

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const canWrite = (role: Role) => ['contributor', 'moderator', 'admin'].includes(role);
const canManageTrash = (role: Role) => ['moderator', 'admin'].includes(role);

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

const formatRemainingTrashTime = (expiresAt?: string | null): string => {
  if (!expiresAt) return 'Expires after 7 days';

  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return 'Expires soon';

  const days = Math.floor(remainingMs / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`;

  const hours = Math.max(1, Math.ceil(remainingMs / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
};

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
  const [viewMode, setViewMode] = useState<'files' | 'trash'>('files');

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DeltaItem | null>(null);
  const [trashItems, setTrashItems] = useState<SpaceItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashActionId, setTrashActionId] = useState<string | null>(null);
  const [trashOffset, setTrashOffset] = useState(0);
  const [trashHasMore, setTrashHasMore] = useState(false);
  const [moveItem, setMoveItem] = useState<DeltaItem | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>('root');
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('root');
  const [bulkMoveLoading, setBulkMoveLoading] = useState(false);
  const [bulkMoveError, setBulkMoveError] = useState<string | null>(null);
  const [bulkCopyOpen, setBulkCopyOpen] = useState(false);
  const [bulkCopyTarget, setBulkCopyTarget] = useState<string>('root');
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [bulkCopyError, setBulkCopyError] = useState<string | null>(null);
  const [copyItem, setCopyItem] = useState<DeltaItem | null>(null);
  const [copyTargetFolder, setCopyTargetFolder] = useState<string>('root');
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [pendingConflicts, setPendingConflicts] = useState<ItemConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, ConflictResolution>>({});
  const [pendingRetry, setPendingRetry] = useState<((res: Record<string, ConflictResolution>) => Promise<void>) | null>(null);

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

  const openConflictModal = (
    conflicts: ItemConflict[],
    retry: (res: Record<string, ConflictResolution>) => Promise<void>,
  ) => {
    setPendingConflicts(conflicts);
    setConflictResolutions(Object.fromEntries(conflicts.map((c) => [c.itemId, 'skip' as ConflictResolution])));
    setPendingRetry(() => retry);
    setConflictModalOpen(true);
  };

  const handleBulkTrash = async () => {
    const fileIds = [...selectedItemIds];
    // TODO: folder trash not yet supported — selectedFolderIds are skipped
    if (fileIds.length === 0) return;
    if (!window.confirm(`Move ${fileIds.length} item(s) to trash?`)) return;
    try {
      await trashItemsApi({ spaceId: space.id, token, itemIds: fileIds });
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      await refreshItems();
    } catch {
      window.alert('Trash failed');
    }
  };

  const submitBulkMove = async (
    e: React.FormEvent<HTMLFormElement>,
    resolutions?: Record<string, ConflictResolution>,
  ) => {
    e.preventDefault();
    const folderId = bulkMoveTarget === 'root' ? null : Number(bulkMoveTarget);
    if (bulkMoveTarget !== 'root' && !Number.isInteger(folderId)) {
      setBulkMoveError('Invalid folder selection');
      return;
    }
    const fileIds = [...selectedItemIds];
    // TODO: folder move not yet supported — selectedFolderIds are skipped
    setBulkMoveError(null);
    try {
      setBulkMoveLoading(true);
      await moveItems({ spaceId: space.id, token, itemIds: fileIds, folderId, resolutions });
      setBulkMoveOpen(false);
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setBulkMoveOpen(false);
        openConflictModal(data.conflicts, async (res) => {
          await submitBulkMove(e, res);
        });
      } else {
        setBulkMoveError('Move failed');
      }
    } finally {
      setBulkMoveLoading(false);
    }
  };

  const submitBulkCopy = async (
    e: React.FormEvent<HTMLFormElement>,
    resolutions?: Record<string, ConflictResolution>,
  ) => {
    e.preventDefault();
    const folderId = bulkCopyTarget === 'root' ? null : Number(bulkCopyTarget);
    if (bulkCopyTarget !== 'root' && !Number.isInteger(folderId)) {
      setBulkCopyError('Invalid folder selection');
      return;
    }
    const fileIds = [...selectedItemIds];
    // TODO: folder copy not yet supported — selectedFolderIds are skipped
    setBulkCopyError(null);
    try {
      setBulkCopyLoading(true);
      await copyItems({ spaceId: space.id, token, itemIds: fileIds, folderId, resolutions });
      setBulkCopyOpen(false);
      await refreshItems();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setBulkCopyOpen(false);
        openConflictModal(data.conflicts, async (res) => {
          await submitBulkCopy(e, res);
        });
      } else {
        setBulkCopyError('Copy failed');
      }
    } finally {
      setBulkCopyLoading(false);
    }
  };

  const handleCopyLink = async (item: DeltaItem) => {
    const link = new URL(`/spaces/${space.id}/view/${item.itemId}`, window.location.origin);

    try {
      await copyToClipboard(link.toString());
      setOpenMenuId(null);
      window.alert('Link copied to clipboard');
    } catch {
      window.alert('Failed to copy link');
    }
  };

  const handleRename = async (item: DeltaItem) => {
    const nextName = window.prompt('Rename file', item.displayName);
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === item.displayName) return;

    try {
      await renameSpaceItem({
        spaceId: space.id,
        itemId: item.itemId,
        displayName: trimmed,
        token,
      });
      setOpenMenuId(null);
      await refreshItems();
    } catch {
      window.alert('Rename failed');
    }
  };

  const handleMoveToFolder = (item: DeltaItem) => {
    setOpenMenuId(null);
    setMoveError(null);
    setMoveItem(item);
    setMoveTargetFolder(item.folderId == null ? 'root' : String(item.folderId));
  };

  const submitMoveToFolder = async (
    e: React.FormEvent<HTMLFormElement>,
    resolutions?: Record<string, ConflictResolution>,
  ) => {
    e.preventDefault();
    if (!moveItem) return;

    const folderId = moveTargetFolder === 'root' ? null : Number(moveTargetFolder);
    if (moveTargetFolder !== 'root' && !Number.isInteger(folderId)) {
      setMoveError('Invalid folder selection');
      return;
    }

    if (folderId === moveItem.folderId && !resolutions) {
      setMoveItem(null);
      return;
    }

    setMoveError(null);
    try {
      setMoveLoading(true);
      await moveItems({ spaceId: space.id, token, itemIds: [moveItem.itemId], folderId, resolutions });
      setMoveItem(null);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setMoveItem(null);
        openConflictModal(data.conflicts, async (res) => {
          await submitMoveToFolder(e, res);
        });
      } else {
        setMoveError('Move failed');
      }
    } finally {
      setMoveLoading(false);
    }
  };

  const handleCopyToFolder = (item: DeltaItem) => {
    setOpenMenuId(null);
    setCopyError(null);
    setCopyItem(item);
    setCopyTargetFolder(item.folderId == null ? 'root' : String(item.folderId));
  };

  const submitCopyToFolder = async (
    e: React.FormEvent<HTMLFormElement>,
    resolutions?: Record<string, ConflictResolution>,
  ) => {
    e.preventDefault();
    if (!copyItem) return;

    const folderId = copyTargetFolder === 'root' ? null : Number(copyTargetFolder);
    if (copyTargetFolder !== 'root' && !Number.isInteger(folderId)) {
      setCopyError('Invalid folder selection');
      return;
    }

    setCopyError(null);
    try {
      setCopyLoading(true);
      await copyItems({ spaceId: space.id, token, itemIds: [copyItem.itemId], folderId, resolutions });
      setCopyItem(null);
      await refreshItems();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setCopyItem(null);
        openConflictModal(data.conflicts, async (res) => {
          await submitCopyToFolder(e, res);
        });
      } else {
        setCopyError('Copy failed');
      }
    } finally {
      setCopyLoading(false);
    }
  };

  const handleDelete = async (item: DeltaItem) => {
    const confirmed = window.confirm(`Move "${item.displayName}" to trash?`);
    if (!confirmed) return;

    try {
      await trashItemsApi({ spaceId: space.id, token, itemIds: [item.itemId] });
      setOpenMenuId(null);
      setSelectedItem((prev) => (prev?.itemId === item.itemId ? null : prev));
      setSelectedItemIds((prev) => {
        if (!prev.has(item.itemId)) return prev;
        const next = new Set(prev);
        next.delete(item.itemId);
        return next;
      });
      await refreshItems();
    } catch {
      window.alert('Move to trash failed');
    }
  };

  const fetchTrash = useCallback(async (offset = 0) => {
    setTrashLoading(true);
    setTrashError(null);
    try {
      const { data } = await getSpaceTrash({ spaceId: space.id, token, limit: TRASH_LIMIT, offset });
      setTrashItems((prev) => offset === 0 ? (data.items ?? []) : [...prev, ...(data.items ?? [])]);
      setTrashHasMore(data.hasMore ?? false);
      setTrashOffset(offset);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Failed to load trash');
    } finally {
      setTrashLoading(false);
    }
  }, [space.id, token]);

  const handleRestoreTrashItem = async (item: SpaceItem) => {
    setTrashActionId(item.itemId);
    setTrashError(null);
    try {
      await restoreSpaceTrashItem({ spaceId: space.id, itemId: item.itemId, token });
      setTrashItems((prev) => prev.filter((trashItem) => trashItem.itemId !== item.itemId));
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Restore failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const handlePermanentDeleteTrashItem = async (item: SpaceItem) => {
    const confirmed = window.confirm(`Permanently delete "${item.displayName}"?`);
    if (!confirmed) return;

    setTrashActionId(item.itemId);
    setTrashError(null);
    try {
      await permanentlyDeleteSpaceTrashItem({ spaceId: space.id, itemId: item.itemId, token });
      setTrashItems((prev) => prev.filter((trashItem) => trashItem.itemId !== item.itemId));
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Permanent delete failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (trashItems.length === 0) return;
    const confirmed = window.confirm('Permanently delete everything in trash?');
    if (!confirmed) return;

    setTrashActionId('empty');
    setTrashError(null);
    try {
      await emptySpaceTrash({ spaceId: space.id, token });
      setTrashItems([]);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Empty trash failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const itemsUrl = `${API_BASE}/spaces/${space.id}/items${
    currentFolder?.id != null ? `?folder_id=${currentFolder.id}` : ''
  }`;

  const {
    data: items,
    loading: itemsLoading,
    error: itemsError,
    refresh: refreshItems,
    nextCursor: itemsNextCursor,
    loadMore: loadMoreItems,
  } = useDeltaSync<DeltaItem>(itemsUrl, {
    token,
    interval: POLL_INTERVAL,
    idKey: 'itemId',
    pageSize: EXPLORER_PAGE_SIZE,
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

  const folderOptions = useMemo(() => {
    const activeFolders = allFolders.filter((folder) => !folder.deleted);
    const byId = new Map(activeFolders.map((folder) => [folder.id, folder]));
    const cache = new Map<number, string>();

    const buildPath = (id: number): string => {
      const cached = cache.get(id);
      if (cached) return cached;

      const folder = byId.get(id);
      if (!folder) return '';

      const path = folder.parent_id != null && byId.has(folder.parent_id)
        ? `${buildPath(folder.parent_id)}/${folder.name}`
        : folder.name;

      cache.set(id, path);
      return path;
    };

    return activeFolders
      .map((folder) => ({ id: folder.id, label: buildPath(folder.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allFolders]);

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

  useEffect(() => {
    void refreshItems();
  }, [currentFolder?.id, refreshItems]);

  useEffect(() => {
    if (viewMode === 'trash') void fetchTrash();
  }, [viewMode, fetchTrash]);

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

  const loading = viewMode === 'trash' ? trashLoading : metaLoading || itemsLoading;
  const error = viewMode === 'trash' ? trashError : metaError ?? itemsError;
  const isEmpty =
    viewMode === 'trash' ? trashItems.length === 0 : subfolders.length === 0 && items.length === 0;

  return (
    <section className="space-explorer">
      <div className="space-explorer__header">
        <h3 className="space-explorer__title">{viewMode === 'trash' ? 'Trash' : 'Explorer'}</h3>
        <div className="space-explorer__header-actions">
          {viewMode === 'files' && canWrite(role) && !selectMode && (
            <button onClick={() => setShowNewFolder(true)}>New Folder</button>
          )}
          {viewMode === 'files' && selectMode && totalSelected > 0 && (
            <button onClick={handleDownload}>Download ({totalSelected})</button>
          )}
          {viewMode === 'files' && selectMode && totalSelected > 0 && canManageTrash(role) && (
            <button onClick={() => { void handleBulkTrash(); }}>Trash ({totalSelected})</button>
          )}
          {viewMode === 'files' && selectMode && totalSelected > 0 && canWrite(role) && (
            <button onClick={() => { setBulkMoveTarget('root'); setBulkMoveError(null); setBulkMoveOpen(true); }}>
              Move ({totalSelected})
            </button>
          )}
          {viewMode === 'files' && selectMode && totalSelected > 0 && canWrite(role) && (
            <button onClick={() => { setBulkCopyTarget('root'); setBulkCopyError(null); setBulkCopyOpen(true); }}>
              Copy ({totalSelected})
            </button>
          )}
          {viewMode === 'files' && (
            <button onClick={toggleSelectMode}>
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
          <button
            onClick={() => {
              setViewMode((prev) => (prev === 'files' ? 'trash' : 'files'));
              setOpenMenuId(null);
              setSelectedItem(null);
              setSelectMode(false);
              setTrashOffset(0);
              setTrashHasMore(false);
            }}
          >
            {viewMode === 'trash' ? 'Back to files' : 'Trash'}
          </button>
          {viewMode === 'trash' && canManageTrash(role) && trashItems.length > 0 && (
            <button onClick={() => { void handleEmptyTrash(); }} disabled={trashActionId === 'empty'}>
              {trashActionId === 'empty' ? 'Emptying…' : 'Empty Trash'}
            </button>
          )}
          {!selectMode && (
            <button
              onClick={() => {
                if (viewMode === 'trash') void fetchTrash();
                else { void refreshItems(); void refreshFolders(); }
              }}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {viewMode === 'files' && <nav className="space-explorer__breadcrumb" aria-label="folder path">
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
      </nav>}

      {viewMode === 'trash' && (
        <p className="space-explorer__message">
          Trashed items are permanently deleted after 7 days.
        </p>
      )}
      {loading && isEmpty && <p className="space-explorer__message">Loading…</p>}
      {error && <p className="space-explorer__message space-explorer__message--error">{error}</p>}
      {!loading && !error && isEmpty && (
        <p className="space-explorer__message">
          {viewMode === 'trash' ? 'Trash is empty.' : 'This folder is empty.'}
        </p>
      )}

      <div className="space-explorer__body">
        {viewMode === 'trash' && trashItems.length > 0 && (
          <div className="space-explorer__grid">
            {trashItems.map((item) => (
              <div key={item.itemId} className="space-explorer__tile-wrap">
                <div className="space-explorer__tile--item">
                  <button
                    type="button"
                    className="space-explorer__tile-btn"
                    title={item.displayName}
                  >
                    <AuthenticatedImage
                      src={itemThumbnailUrl(space.id, item.itemId)}
                      token={token}
                      alt={item.displayName}
                      loading="lazy"
                      className="space-explorer__thumb"
                    />
                  </button>
                </div>
                <div className="space-explorer__trash-actions">
                  <span className="space-explorer__trash-meta">
                    {formatRemainingTrashTime(item.expiresAt)}
                  </span>
                  {canManageTrash(role) && (
                    <>
                      <button
                        type="button"
                        onClick={() => { void handleRestoreTrashItem(item); }}
                        disabled={trashActionId !== null}
                      >
                        {trashActionId === item.itemId ? 'Working…' : 'Restore'}
                      </button>
                      <button
                        type="button"
                        className="space-explorer__trash-danger"
                        onClick={() => { void handlePermanentDeleteTrashItem(item); }}
                        disabled={trashActionId !== null}
                      >
                        Delete forever
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'files' && (subfolders.length > 0 || items.length > 0) && (
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
                    <AuthenticatedImage
                      src={itemThumbnailUrl(space.id, item.itemId)}
                      token={token}
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
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { void handleCopyLink(item); }}
                    >Copy link</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => {
                        setOpenMenuId(null);
                        void downloadSelected({ spaceId: space.id, token, itemIds: [item.itemId], folderIds: [] });
                      }}
                    >Download</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { void handleRename(item); }}
                    >Rename</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { handleMoveToFolder(item); }}
                    >Move to folder</button>
                    {canWrite(role) && (
                      <button
                        type="button"
                        className="space-explorer__menu-item"
                        onClick={() => { handleCopyToFolder(item); }}
                      >Copy to folder</button>
                    )}
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { setSelectedItem(item); setOpenMenuId(null); }}
                    >
                      Get details
                    </button>
                    {canManageTrash(role) && (
                      <>
                        <hr className="space-explorer__menu-divider" />
                        <button
                          type="button"
                          className="space-explorer__menu-item space-explorer__menu-item--danger"
                          onClick={() => { void handleDelete(item); }}
                        >
                          Move to trash
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {viewMode === 'files' && itemsNextCursor && (
          <button
            className="space-explorer__load-more"
            onClick={() => void loadMoreItems()}
          >
            Load more
          </button>
        )}

        {viewMode === 'trash' && trashHasMore && (
          <button
            className="space-explorer__load-more"
            onClick={() => void fetchTrash(trashOffset + TRASH_LIMIT)}
            disabled={trashLoading}
          >
            {trashLoading ? 'Loading…' : 'Load more'}
          </button>
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
            <AuthenticatedImage
              src={selectedItem.thumbnailUrl}
              token={token}
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
                <AuthenticatedVideo
                  src={itemFileUrl(space.id, activeItem.itemId)}
                  token={token}
                  className="space-explorer__lightbox-video"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <AuthenticatedImage
                  src={itemFileUrl(space.id, activeItem.itemId)}
                  token={token}
                  alt={activeItem.displayName}
                  className="space-explorer__lightbox-image"
                />
              )}
            </div>
            <div className="space-explorer__lightbox-footer">
              <p className="space-explorer__lightbox-name">{activeItem.displayName}</p>
              <button
                type="button"
                className="space-explorer__lightbox-view-full"
                onClick={() => navigate(`/spaces/${space.id}/view/${activeItem.itemId}`)}
              >
                View in full
              </button>
            </div>
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

      {bulkMoveOpen && (
        <Modal
          title={<>Move {selectedItemIds.size} item(s)</>}
          onClose={() => {
            if (!bulkMoveLoading) {
              setBulkMoveOpen(false);
              setBulkMoveError(null);
            }
          }}
        >
          <form className="modal__form" onSubmit={(e) => { void submitBulkMove(e); }}>
            <select
              className="modal__input"
              value={bulkMoveTarget}
              onChange={(e) => setBulkMoveTarget(e.target.value)}
              disabled={bulkMoveLoading}
            >
              <option value="root">Root (no folder)</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={String(folder.id)}>
                  {folder.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="modal__btn modal__btn--primary modal__btn--full"
              disabled={bulkMoveLoading}
            >
              {bulkMoveLoading ? 'Moving…' : 'Move'}
            </button>
            {bulkMoveError && <p className="modal__error">{bulkMoveError}</p>}
          </form>
        </Modal>
      )}

      {moveItem && (
        <Modal
          title={
            <>
              Move <span className="modal__title-accent">{moveItem.displayName}</span>
            </>
          }
          onClose={() => {
            if (!moveLoading) {
              setMoveItem(null);
              setMoveError(null);
            }
          }}
        >
          <form className="modal__form" onSubmit={(e) => { void submitMoveToFolder(e); }}>
            <select
              className="modal__input"
              value={moveTargetFolder}
              onChange={(e) => setMoveTargetFolder(e.target.value)}
              disabled={moveLoading}
            >
              <option value="root">Root (no folder)</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={String(folder.id)}>
                  {folder.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="modal__btn modal__btn--primary modal__btn--full"
              disabled={moveLoading}
            >
              {moveLoading ? 'Moving…' : 'Move'}
            </button>
            {moveError && <p className="modal__error">{moveError}</p>}
          </form>
        </Modal>
      )}

      {copyItem && (
        <Modal
          title={
            <>
              Copy <span className="modal__title-accent">{copyItem.displayName}</span>
            </>
          }
          onClose={() => {
            if (!copyLoading) {
              setCopyItem(null);
              setCopyError(null);
            }
          }}
        >
          <form className="modal__form" onSubmit={(e) => { void submitCopyToFolder(e); }}>
            <select
              className="modal__input"
              value={copyTargetFolder}
              onChange={(e) => setCopyTargetFolder(e.target.value)}
              disabled={copyLoading}
            >
              <option value="root">Root (no folder)</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={String(folder.id)}>
                  {folder.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="modal__btn modal__btn--primary modal__btn--full"
              disabled={copyLoading}
            >
              {copyLoading ? 'Copying…' : 'Copy'}
            </button>
            {copyError && <p className="modal__error">{copyError}</p>}
          </form>
        </Modal>
      )}

      {bulkCopyOpen && (
        <Modal
          title={<>Copy {selectedItemIds.size} item(s)</>}
          onClose={() => {
            if (!bulkCopyLoading) {
              setBulkCopyOpen(false);
              setBulkCopyError(null);
            }
          }}
        >
          <form className="modal__form" onSubmit={(e) => { void submitBulkCopy(e); }}>
            <select
              className="modal__input"
              value={bulkCopyTarget}
              onChange={(e) => setBulkCopyTarget(e.target.value)}
              disabled={bulkCopyLoading}
            >
              <option value="root">Root (no folder)</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={String(folder.id)}>
                  {folder.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="modal__btn modal__btn--primary modal__btn--full"
              disabled={bulkCopyLoading}
            >
              {bulkCopyLoading ? 'Copying…' : 'Copy'}
            </button>
            {bulkCopyError && <p className="modal__error">{bulkCopyError}</p>}
          </form>
        </Modal>
      )}

      {conflictModalOpen && (
        <Modal
          title="Name conflicts"
          onClose={() => {
            setConflictModalOpen(false);
            setPendingRetry(null);
          }}
        >
          <div className="modal__form">
            <p className="modal__hint">These items already exist in the destination. Choose what to do for each:</p>
            {pendingConflicts.map((conflict) => (
              <div key={conflict.itemId} className="modal__conflict-row">
                <span className="modal__conflict-name">{conflict.displayName}</span>
                <select
                  className="modal__input modal__input--sm"
                  value={conflictResolutions[conflict.itemId] ?? 'skip'}
                  onChange={(e) =>
                    setConflictResolutions((prev) => ({
                      ...prev,
                      [conflict.itemId]: e.target.value as ConflictResolution,
                    }))
                  }
                >
                  <option value="skip">Skip</option>
                  <option value="replace">Replace</option>
                  <option value="keep_both">Keep both</option>
                </select>
              </div>
            ))}
            <button
              type="button"
              className="modal__btn modal__btn--primary modal__btn--full"
              onClick={() => {
                setConflictModalOpen(false);
                void pendingRetry?.(conflictResolutions);
              }}
            >
              Continue
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
