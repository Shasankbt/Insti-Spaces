import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  copyItems,
  copySpaceFolder,
  deleteSpaceFolder,
  downloadSelected,
  getSpaceExplorer,
  likeSpaceItem,
  unlikeSpaceItem,
  moveSpaceFolder,
  moveItems,
  renameSpaceItem,
  trashItems as trashItemsApi,
} from '../../Api';
import type { ConflictResolution, ItemConflict } from '../../Api';
import { useDeltaSync } from '../../hooks/useDeltaSync';
import type { ExplorerFolder, Role, Space, SpaceItem } from '../../types';
import { AuthenticatedImage, AuthenticatedVideo } from './AuthenticatedMedia';
import CreateFolderModal from './CreateFolderModal';
import Modal from './Modal';
import { API_BASE, EXPLORER_PAGE_SIZE, POLL_INTERVAL } from '../../constants';
import { itemFileUrl, itemThumbnailUrl } from '../../utils';
import {
  IconBack,
  IconChevron,
  IconCopy,
  IconDownload,
  IconDots,
  IconHome,
  IconMove,
  IconNewFolder,
  IconRefresh,
  IconSelect,
  IconUpload,
} from './Icons';

interface SpaceExplorerProps {
  space: Space;
  token: string;
  role: Role;
  refreshTrigger?: number;
  onFolderChange?: (folderId: number | null) => void;
  onUpload?: () => void;
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
const canMoveItemsToTrash = canWrite;

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

/* ── Folder picker (mini-explorer for move / copy destination) ── */

interface PickerFile {
  itemId: string;
  displayName: string;
}

function FolderPicker({
  space,
  token,
  allFolders,
  excludeFolderIds,
  loading,
  error,
  onConfirm,
  confirmLabel,
}: {
  space: Space;
  token: string;
  allFolders: DeltaFolder[];
  excludeFolderIds: Set<number>;
  loading: boolean;
  error: string | null;
  onConfirm: (folderId: number | null) => void;
  confirmLabel: string;
}) {
  const [folderId, setFolderId] = useState<number | null>(null);
  const [stack, setStack] = useState<{ id: number; name: string }[]>([]);
  const [items, setItems] = useState<PickerFile[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const subfolders = allFolders.filter(
    (f) => !f.deleted && !excludeFolderIds.has(f.id) && f.parent_id === folderId,
  );

  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    const url = folderId != null
      ? `${API_BASE}/spaces/${space.id}/items?folder_id=${folderId}&limit=30`
      : `${API_BASE}/spaces/${space.id}/items?limit=30`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d: { items?: PickerFile[] }) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setItemsLoading(false); });
    return () => { cancelled = true; };
  }, [folderId, space.id, token]);

  const enterFolder = (f: DeltaFolder) => {
    setStack((prev) => [...prev, { id: f.id, name: f.name }]);
    setFolderId(f.id);
  };

  const goToIndex = (i: number) => {
    if (i < 0) {
      setStack([]);
      setFolderId(null);
    } else {
      const newStack = stack.slice(0, i + 1);
      setStack(newStack);
      setFolderId(newStack[i]!.id);
    }
  };

  return (
    <div className="folder-picker">
      <div className="folder-picker__nav">
        {stack.length > 0 && (
          <button
            type="button"
            className="folder-picker__back"
            onClick={() => goToIndex(stack.length - 2)}
            aria-label="Go up"
          >
            <IconBack />
          </button>
        )}
        <button
          type="button"
          className={`folder-picker__crumb${folderId === null ? ' folder-picker__crumb--current' : ''}`}
          onClick={() => goToIndex(-1)}
        >
          <IconHome />
        </button>
        {stack.map((seg, i) => (
          <span key={seg.id} className="folder-picker__crumb-wrap">
            <span className="folder-picker__sep">/</span>
            <button
              type="button"
              className={`folder-picker__crumb${i === stack.length - 1 ? ' folder-picker__crumb--current' : ''}`}
              onClick={() => goToIndex(i)}
            >
              {seg.name}
            </button>
          </span>
        ))}
      </div>

      <div className="folder-picker__grid">
        {subfolders.map((f) => (
          <button
            key={f.id}
            type="button"
            className="folder-picker__folder"
            onClick={() => enterFolder(f)}
          >
            <span className="folder-picker__folder-icon"><IconNewFolder /></span>
            <span className="folder-picker__folder-name">{f.name}</span>
            <span className="folder-picker__folder-arrow"><IconChevron /></span>
          </button>
        ))}
        {items.map((item) => (
          <div key={item.itemId} className="folder-picker__item">
            <AuthenticatedImage
              src={itemThumbnailUrl(space.id, item.itemId)}
              token={token}
              alt={item.displayName}
              className="folder-picker__thumb"
            />
          </div>
        ))}
        {!itemsLoading && subfolders.length === 0 && items.length === 0 && (
          <p className="folder-picker__empty">This folder is empty</p>
        )}
        {itemsLoading && <p className="folder-picker__empty">Loading…</p>}
      </div>

      {error && <p className="folder-picker__error">{error}</p>}

      <button
        type="button"
        className="folder-picker__confirm"
        onClick={() => onConfirm(folderId)}
        disabled={loading}
      >
        {loading ? `${confirmLabel}ing…` : `${confirmLabel} here`}
      </button>
    </div>
  );
}

/* ── Main component ── */

export default function SpaceExplorer({
  space,
  token,
  role,
  refreshTrigger,
  onFolderChange,
  onUpload,
}: SpaceExplorerProps) {
  const { '*': folderPath = '' } = useParams<{ '*': string }>();
  const navigate = useNavigate();

  const [breadcrumbs, setBreadcrumbs] = useState<ExplorerFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<ExplorerFolder | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DeltaItem | null>(null);
  const [moveItem, setMoveItem] = useState<DeltaItem | null>(null);
  const [moveFolder, setMoveFolder] = useState<DeltaFolder | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveLoading, setBulkMoveLoading] = useState(false);
  const [bulkMoveError, setBulkMoveError] = useState<string | null>(null);
  const [bulkCopyOpen, setBulkCopyOpen] = useState(false);
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [bulkCopyError, setBulkCopyError] = useState<string | null>(null);
  const [copyItem, setCopyItem] = useState<DeltaItem | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyFolder, setCopyFolder] = useState<DeltaFolder | null>(null);
  const [copyFolderLoading, setCopyFolderLoading] = useState(false);
  const [copyFolderError, setCopyFolderError] = useState<string | null>(null);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [pendingConflicts, setPendingConflicts] = useState<ItemConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, ConflictResolution>>({});
  const [pendingRetry, setPendingRetry] = useState<((res: Record<string, ConflictResolution>) => Promise<void>) | null>(null);
  const [likeOverrides, setLikeOverrides] = useState<Record<string, { likeCount: number; likedByMe: boolean }>>({});
  const likeRequestInFlight = useRef(new Set<string>());

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
    const folderIds = [...selectedFolderIds];
    if (fileIds.length === 0 && folderIds.length === 0) return;
    if (folderIds.length > 0 && !canManageTrash(role)) {
      window.alert('Only admins and moderators can move folders to trash');
      return;
    }
    if (!window.confirm(`Move ${fileIds.length + folderIds.length} selected item(s) to trash?`)) return;
    try {
      if (fileIds.length > 0) await trashItemsApi({ spaceId: space.id, token, itemIds: fileIds });
      await Promise.all(folderIds.map((folderId) => deleteSpaceFolder({ spaceId: space.id, token, folderId })));
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      setSelectMode(false);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      window.alert(response?.data?.error ?? `Trash failed${response?.status ? ` (${response.status})` : ''}`);
    }
  };

  const doMoveSelected = async (folderId: number | null, resolutions?: Record<string, ConflictResolution>) => {
    const fileIds = [...selectedItemIds];
    const folderIds = [...selectedFolderIds];
    setBulkMoveError(null);
    setBulkMoveLoading(true);
    try {
      if (fileIds.length > 0) {
        await moveItems({ spaceId: space.id, token, itemIds: fileIds, folderId, resolutions });
      }
      await Promise.all(folderIds.map((id) => moveSpaceFolder({ spaceId: space.id, token, folderId: id, parentId: folderId })));
      setBulkMoveOpen(false);
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      setSelectMode(false);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setBulkMoveOpen(false);
        openConflictModal(data.conflicts, async (res) => { await doMoveSelected(folderId, res); });
      } else {
        setBulkMoveError('Move failed');
      }
    } finally {
      setBulkMoveLoading(false);
    }
  };

  const doCopySelected = async (folderId: number | null, resolutions?: Record<string, ConflictResolution>) => {
    const fileIds = [...selectedItemIds];
    setBulkCopyError(null);
    setBulkCopyLoading(true);
    try {
      await copyItems({ spaceId: space.id, token, itemIds: fileIds, folderId, resolutions });
      setBulkCopyOpen(false);
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      setSelectMode(false);
      await refreshItems();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setBulkCopyOpen(false);
        openConflictModal(data.conflicts, async (res) => { await doCopySelected(folderId, res); });
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
      await renameSpaceItem({ spaceId: space.id, itemId: item.itemId, displayName: trimmed, token });
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
    setMoveFolder(null);
  };

  const handleMoveFolder = (folder: DeltaFolder) => {
    setOpenMenuId(null);
    setMoveError(null);
    setMoveItem(null);
    setMoveFolder(folder);
  };

  const doMoveItem = async (folderId: number | null, resolutions?: Record<string, ConflictResolution>) => {
    const item = moveItem;
    const folder = moveFolder;
    if (!item && !folder) return;
    setMoveError(null);
    setMoveLoading(true);
    try {
      if (item) {
        await moveItems({ spaceId: space.id, token, itemIds: [item.itemId], folderId, resolutions });
      } else if (folder) {
        await moveSpaceFolder({ spaceId: space.id, token, folderId: folder.id, parentId: folderId });
      }
      setMoveItem(null);
      setMoveFolder(null);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        openConflictModal(data.conflicts, async (res) => {
          setMoveLoading(true);
          try {
            if (item) await moveItems({ spaceId: space.id, token, itemIds: [item.itemId], folderId, resolutions: res });
            else if (folder) await moveSpaceFolder({ spaceId: space.id, token, folderId: folder.id, parentId: folderId });
            setMoveItem(null);
            setMoveFolder(null);
            await refreshItems();
            await refreshFolders();
          } catch { window.alert('Move failed'); }
          finally { setMoveLoading(false); }
        });
      } else {
        const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
        setMoveError(response?.data?.error ?? `Move failed${response?.status ? ` (${response.status})` : ''}`);
      }
    } finally {
      setMoveLoading(false);
    }
  };

  const handleCopyToFolder = (item: DeltaItem) => {
    setOpenMenuId(null);
    setCopyError(null);
    setCopyItem(item);
    setCopyFolder(null);
  };

  const handleCopyFolderTo = (folder: DeltaFolder) => {
    setOpenMenuId(null);
    setCopyFolderError(null);
    setCopyFolder(folder);
    setCopyItem(null);
  };

  const doCopyFolderTo = async (targetParentId: number | null) => {
    if (!copyFolder) return;
    setCopyFolderError(null);
    setCopyFolderLoading(true);
    try {
      await copySpaceFolder({ spaceId: space.id, token, folderId: copyFolder.id, targetParentId });
      setCopyFolder(null);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCopyFolderError(msg ?? 'Copy failed');
    } finally {
      setCopyFolderLoading(false);
    }
  };

  const doCopyItem = async (folderId: number | null, resolutions?: Record<string, ConflictResolution>) => {
    const item = copyItem;
    if (!item) return;
    setCopyError(null);
    setCopyLoading(true);
    try {
      await copyItems({ spaceId: space.id, token, itemIds: [item.itemId], folderId, resolutions });
      setCopyItem(null);
      await refreshItems();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        openConflictModal(data.conflicts, async (res) => { await doCopyItem(folderId, res); });
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

  const handleDeleteFolder = async (folder: DeltaFolder) => {
    const confirmed = window.confirm(`Move folder "${folder.name}" and its contents to trash?`);
    if (!confirmed) return;
    try {
      await deleteSpaceFolder({ spaceId: space.id, token, folderId: folder.id });
      setOpenMenuId(null);
      setSelectedFolderIds((prev) => {
        if (!prev.has(folder.id)) return prev;
        const next = new Set(prev);
        next.delete(folder.id);
        return next;
      });
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      window.alert(response?.data?.error ?? `Move folder to trash failed${response?.status ? ` (${response.status})` : ''}`);
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

  useEffect(() => {
    setLikeOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of items) {
        const override = next[item.itemId];
        if (!override) continue;
        if ((item.likedByMe ?? false) === override.likedByMe) {
          delete next[item.itemId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  const displayItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        likeCount: likeOverrides[item.itemId]?.likeCount ?? item.likeCount ?? 0,
        likedByMe: likeOverrides[item.itemId]?.likedByMe ?? item.likedByMe ?? false,
      })),
    [items, likeOverrides],
  );

  const handleLikeItem = useCallback(async (item: DeltaItem) => {
    const current = {
      likeCount: likeOverrides[item.itemId]?.likeCount ?? item.likeCount ?? 0,
      likedByMe: likeOverrides[item.itemId]?.likedByMe ?? item.likedByMe ?? false,
    };
    if (likeRequestInFlight.current.has(item.itemId)) return;
    likeRequestInFlight.current.add(item.itemId);
    setLikeOverrides((prev) => ({
      ...prev,
      [item.itemId]: {
        likeCount: current.likedByMe ? current.likeCount - 1 : current.likeCount + 1,
        likedByMe: !current.likedByMe,
      },
    }));
    try {
      const { data } = current.likedByMe
        ? await unlikeSpaceItem({ spaceId: space.id, itemId: item.itemId, token })
        : await likeSpaceItem({ spaceId: space.id, itemId: item.itemId, token });
      setLikeOverrides((prev) => ({
        ...prev,
        [item.itemId]: { likeCount: data.likeCount, likedByMe: data.likedByMe },
      }));
    } catch {
      setLikeOverrides((prev) => ({ ...prev, [item.itemId]: current }));
    } finally {
      likeRequestInFlight.current.delete(item.itemId);
    }
  }, [likeOverrides, space.id, token]);

  const { data: allFolders, refresh: refreshFolders } = useDeltaSync<DeltaFolder>(
    `${API_BASE}/spaces/${space.id}/folders`,
    { token, interval: POLL_INTERVAL, idKey: 'id' },
  );

  const subfolders = allFolders.filter((f) => f.parent_id === (currentFolder?.id ?? null));

  /* Excluded folder IDs for move-folder picker (can't move into self or descendant) */
  const excludedFolderIds = useMemo(() => {
    if (!moveFolder) return new Set<number>();
    const result = new Set<number>([moveFolder.id]);
    const queue = [moveFolder.id];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const f of allFolders) {
        if (f.parent_id === parentId && !f.deleted && !result.has(f.id)) {
          result.add(f.id);
          queue.push(f.id);
        }
      }
    }
    return result;
  }, [moveFolder, allFolders]);

  const resolveMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const { data } = await getSpaceExplorer({ spaceId: space.id, token, path: folderPath || undefined });
      setBreadcrumbs(data.breadcrumbs);
      setCurrentFolder(data.currentFolder);
      onFolderChange?.(data.currentFolder?.id ?? null);
    } catch {
      setMetaError('Folder not found');
    } finally {
      setMetaLoading(false);
    }
  }, [space.id, token, folderPath, onFolderChange]);

  const isMountMeta = useRef(true);
  useEffect(() => { void resolveMeta(); }, [resolveMeta]);

  useEffect(() => {
    if (isMountMeta.current) { isMountMeta.current = false; return; }
    void refreshFolders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath]);

  const isMountRefresh = useRef(true);
  useEffect(() => {
    if (isMountRefresh.current) { isMountRefresh.current = false; return; }
    void refreshItems();
  }, [refreshTrigger, refreshItems]);

  useEffect(() => { void refreshItems(); }, [currentFolder?.id, refreshItems]);

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
        setLightboxIndex((prev) => prev == null ? prev : Math.min(displayItems.length - 1, prev + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, displayItems.length]);

  const navigateToFolder = (folder: DeltaFolder) => {
    const segments = [
      ...breadcrumbs.map((b) => encodeURIComponent(b.name)),
      ...(currentFolder ? [encodeURIComponent(currentFolder.name)] : []),
      encodeURIComponent(folder.name),
    ];
    navigate(`/spaces/${space.id}/${segments.join('/')}`);
  };

  const navigateToBreadcrumb = (index: number) => {
    const segments = breadcrumbs.slice(0, index + 1).map((b) => encodeURIComponent(b.name));
    navigate(`/spaces/${space.id}/${segments.join('/')}`);
  };

  const navigateToRoot = () => navigate(`/spaces/${space.id}`);

  const navigateBack = () => {
    if (!currentFolder) return;
    if (breadcrumbs.length === 0) navigateToRoot();
    else navigateToBreadcrumb(breadcrumbs.length - 1);
  };

  const activeItem = lightboxIndex == null ? null : (displayItems[lightboxIndex] ?? null);
  const hasPrev = lightboxIndex != null && lightboxIndex > 0;
  const hasNext = lightboxIndex != null && lightboxIndex < displayItems.length - 1;
  const loading = metaLoading || itemsLoading;
  const error = metaError ?? itemsError;
  const isEmpty = subfolders.length === 0 && displayItems.length === 0;

  return (
    <section className="space-explorer">

      {/* ── Toolbar ── */}
      <div className="space-explorer__header">
        <div className="space-explorer__toolbar">
          <button
            className="explorer-toolbar__icon-btn"
            title={loading ? 'Refreshing…' : 'Refresh'}
            disabled={loading}
            onClick={() => { void refreshItems(); void refreshFolders(); }}
          ><IconRefresh /></button>

          {canWrite(role) && !selectMode && (
            <button className="explorer-toolbar__icon-btn" title="New folder" onClick={() => setShowNewFolder(true)}>
              <IconNewFolder />
            </button>
          )}

          {onUpload && canWrite(role) && (
            <button className="explorer-toolbar__icon-btn" title="Upload" onClick={onUpload}><IconUpload /></button>
          )}

          <button
            className={`explorer-toolbar__icon-btn${selectMode ? ' explorer-toolbar__icon-btn--active' : ''}`}
            title={selectMode ? 'Exit selection' : 'Select items'}
            onClick={toggleSelectMode}
          >
            <IconSelect />
          </button>

          {selectMode && totalSelected > 0 && (
            <>
              {canWrite(role) && (
                <button
                  className="explorer-toolbar__icon-btn"
                  title={`Move ${totalSelected} selected`}
                  onClick={() => { setBulkMoveError(null); setBulkMoveOpen(true); }}
                ><IconMove /></button>
              )}
              {canWrite(role) && selectedItemIds.size > 0 && (
                <button
                  className="explorer-toolbar__icon-btn"
                  title={`Copy ${selectedItemIds.size} selected`}
                  onClick={() => { setBulkCopyError(null); setBulkCopyOpen(true); }}
                ><IconCopy /></button>
              )}
              <button
                className="explorer-toolbar__icon-btn"
                title={`Download ${totalSelected} selected`}
                onClick={handleDownload}
              ><IconDownload /></button>
              {(selectedItemIds.size > 0 ? canMoveItemsToTrash(role) : canManageTrash(role)) && (
                <button
                  className="explorer-toolbar__icon-btn explorer-toolbar__icon-btn--danger"
                  title={`Move ${totalSelected} to trash`}
                  onClick={() => { void handleBulkTrash(); }}
                >🗑</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Breadcrumb — pill nav ── */}
      <nav className="space-explorer__breadcrumb" aria-label="folder path">
        {currentFolder && (
          <button type="button" className="space-explorer__breadcrumb-back" onClick={navigateBack} aria-label="Go up">
            <IconBack />
          </button>
        )}
        <button
          type="button"
          className={`space-explorer__breadcrumb-pill${!currentFolder ? ' space-explorer__breadcrumb-pill--current' : ''}`}
          onClick={navigateToRoot}
        >
          <IconHome className="space-explorer__breadcrumb-home-icon" /> root
        </button>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.id} className="space-explorer__breadcrumb-group">
            <span className="space-explorer__breadcrumb-sep">›</span>
            <button
              type="button"
              className="space-explorer__breadcrumb-pill"
              onClick={() => navigateToBreadcrumb(i)}
            >
              {crumb.name}
            </button>
          </span>
        ))}
        {currentFolder && (
          <span className="space-explorer__breadcrumb-group">
            <span className="space-explorer__breadcrumb-sep">›</span>
            <span className="space-explorer__breadcrumb-pill space-explorer__breadcrumb-pill--current">
              {currentFolder.name}
            </span>
          </span>
        )}
      </nav>

      {loading && isEmpty && <p className="space-explorer__message">Loading…</p>}
      {error && <p className="space-explorer__message space-explorer__message--error">{error}</p>}
      {!loading && !error && isEmpty && <p className="space-explorer__message">This folder is empty.</p>}

      <div className="space-explorer__body">
        {(subfolders.length > 0 || displayItems.length > 0) && (
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
                  <span className="space-explorer__folder-icon"><IconNewFolder /></span>
                  <span className="space-explorer__folder-name">{folder.name}</span>
                </button>

                {!selectMode && canWrite(role) && (
                  <button
                    type="button"
                    className="space-explorer__menu-btn"
                    aria-label="Folder options"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId !== `folder-${folder.id}` ? `folder-${folder.id}` : null);
                    }}
                  ><IconDots /></button>
                )}

                {openMenuId === `folder-${folder.id}` && (
                  <div className="space-explorer__menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="space-explorer__menu-item" onClick={() => handleMoveFolder(folder)}>
                      Move to folder
                    </button>
                    <button type="button" className="space-explorer__menu-item" onClick={() => handleCopyFolderTo(folder)}>
                      Copy to folder
                    </button>
                    <button
                      type="button"
                      className="space-explorer__menu-item space-explorer__menu-item--danger"
                      onClick={() => { void handleDeleteFolder(folder); }}
                    >
                      Move to trash
                    </button>
                  </div>
                )}
              </div>
            ))}

            {displayItems.map((item, index) => (
              <div
                key={item.itemId}
                className={`space-explorer__tile-wrap space-explorer__tile-wrap--item${selectedItemIds.has(item.itemId) ? ' space-explorer__tile-wrap--selected' : ''}`}
              >
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

                {/* name + ⋮ below the thumbnail */}
                <div className="space-explorer__tile-footer">
                  <span className="space-explorer__item-name" title={item.displayName}>
                    {item.displayName}
                  </span>
                  <button
                    type="button"
                    className="space-explorer__tile-menu-btn"
                    aria-label="Item options"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId !== item.itemId ? item.itemId : null);
                    }}
                  ><IconDots /></button>
                </div>

                {openMenuId === item.itemId && (
                  <div className="space-explorer__menu space-explorer__menu--above" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { setSelectedItem(item); setOpenMenuId(null); }}
                    >Info</button>
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
                      onClick={() => handleMoveToFolder(item)}
                    >Move to folder</button>
                    {canWrite(role) && (
                      <button
                        type="button"
                        className="space-explorer__menu-item"
                        onClick={() => handleCopyToFolder(item)}
                      >Copy to folder</button>
                    )}
                    {canMoveItemsToTrash(role) && (
                      <>
                        <hr className="space-explorer__menu-divider" />
                        <button
                          type="button"
                          className="space-explorer__menu-item space-explorer__menu-item--danger"
                          onClick={() => { void handleDelete(item); }}
                        >Move to trash</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {itemsNextCursor && (
          <button className="space-explorer__load-more" onClick={() => void loadMoreItems()}>
            Load more
          </button>
        )}

        {selectedItem && (
          <aside className="space-explorer__info-panel">
            <button
              type="button"
              className="space-explorer__info-close"
              onClick={() => setSelectedItem(null)}
              aria-label="Close info panel"
            >✕</button>
            <AuthenticatedImage
              src={itemThumbnailUrl(space.id, selectedItem.itemId)}
              token={token}
              alt={selectedItem.displayName}
              className="space-explorer__info-thumb"
            />
            <h4 className="space-explorer__info-name">{selectedItem.displayName}</h4>
            <dl className="space-explorer__info-dl">
              <dt>Type</dt><dd>{selectedItem.mimeType}</dd>
              <dt>Uploaded</dt><dd>{formatDate(selectedItem.uploadedAt)}</dd>
              <dt>Size</dt><dd>{formatBytes(selectedItem.sizeBytes)}</dd>
            </dl>
          </aside>
        )}
      </div>

      {/* ── Lightbox ── */}
      {activeItem && (
        <div
          className="space-explorer__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={activeItem.displayName}
          onClick={() => setLightboxIndex(null)}
        >
          <div className="space-explorer__lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="space-explorer__lightbox-close" onClick={() => setLightboxIndex(null)} aria-label="Close">✕</button>
            <div className="space-explorer__lightbox-stage">
              <button
                type="button"
                className="space-explorer__lightbox-hit space-explorer__lightbox-hit--prev"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => (p == null ? p : Math.max(0, p - 1))); }}
                disabled={!hasPrev}
                aria-label="Previous"
              />
              <button
                type="button"
                className="space-explorer__lightbox-hit space-explorer__lightbox-hit--next"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => p == null ? p : Math.min(displayItems.length - 1, p + 1)); }}
                disabled={!hasNext}
                aria-label="Next"
              />
              {isVideoMime(activeItem.mimeType) ? (
                <AuthenticatedVideo
                  src={itemFileUrl(space.id, activeItem.itemId)}
                  token={token}
                  className="space-explorer__lightbox-video"
                  controls autoPlay playsInline
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
                className={`space-explorer__lightbox-like${activeItem.likedByMe ? ' space-explorer__lightbox-like--active' : ''}`}
                onClick={() => void handleLikeItem(activeItem)}
              >
                <span aria-hidden="true">♥</span>
                <span>{activeItem.likeCount ?? 0}</span>
              </button>
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

      {/* ── Picker modals (FolderPicker replaces <select>) ── */}

      {bulkMoveOpen && (
        <Modal
          title={<>Move {totalSelected} selected</>}
          onClose={() => { if (!bulkMoveLoading) { setBulkMoveOpen(false); setBulkMoveError(null); } }}
        >
          <FolderPicker
            space={space}
            token={token}
            allFolders={allFolders}
            excludeFolderIds={new Set()}
            loading={bulkMoveLoading}
            error={bulkMoveError}
            onConfirm={(fid) => void doMoveSelected(fid)}
            confirmLabel="Move"
          />
        </Modal>
      )}

      {(moveItem != null || moveFolder != null) && (
        <Modal
          title={<>Move <span className="modal__title-accent">{moveItem?.displayName ?? moveFolder?.name}</span></>}
          onClose={() => { if (!moveLoading) { setMoveItem(null); setMoveFolder(null); setMoveError(null); } }}
        >
          <FolderPicker
            space={space}
            token={token}
            allFolders={allFolders}
            excludeFolderIds={excludedFolderIds}
            loading={moveLoading}
            error={moveError}
            onConfirm={(fid) => void doMoveItem(fid)}
            confirmLabel="Move"
          />
        </Modal>
      )}

      {copyItem != null && (
        <Modal
          title={<>Copy <span className="modal__title-accent">{copyItem.displayName}</span></>}
          onClose={() => { if (!copyLoading) { setCopyItem(null); setCopyError(null); } }}
        >
          <FolderPicker
            space={space}
            token={token}
            allFolders={allFolders}
            excludeFolderIds={new Set()}
            loading={copyLoading}
            error={copyError}
            onConfirm={(fid) => void doCopyItem(fid)}
            confirmLabel="Copy"
          />
        </Modal>
      )}

      {copyFolder != null && (
        <Modal
          title={<>Copy <span className="modal__title-accent">{copyFolder.name}</span></>}
          onClose={() => { if (!copyFolderLoading) { setCopyFolder(null); setCopyFolderError(null); } }}
        >
          <FolderPicker
            space={space}
            token={token}
            allFolders={allFolders}
            excludeFolderIds={new Set()}
            loading={copyFolderLoading}
            error={copyFolderError}
            onConfirm={(fid) => void doCopyFolderTo(fid)}
            confirmLabel="Copy"
          />
        </Modal>
      )}

      {bulkCopyOpen && (
        <Modal
          title={<>Copy {selectedItemIds.size} item(s)</>}
          onClose={() => { if (!bulkCopyLoading) { setBulkCopyOpen(false); setBulkCopyError(null); } }}
        >
          <FolderPicker
            space={space}
            token={token}
            allFolders={allFolders}
            excludeFolderIds={new Set()}
            loading={bulkCopyLoading}
            error={bulkCopyError}
            onConfirm={(fid) => void doCopySelected(fid)}
            confirmLabel="Copy"
          />
        </Modal>
      )}

      {/* ── Conflict resolution ── */}
      {conflictModalOpen && (
        <Modal
          title="Name conflicts"
          onClose={() => { setConflictModalOpen(false); setPendingRetry(null); }}
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
              onClick={() => { setConflictModalOpen(false); void pendingRetry?.(conflictResolutions); }}
            >
              Continue
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
