import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  copyItems,
  copySpaceFolder,
  deleteSpaceFolder,
  downloadSelected,
  emptySpaceTrash,
  getSpaceExplorer,
  getSpaceTrash,
  likeSpaceItem,
  unlikeSpaceItem,
  moveSpaceFolder,
  moveItems,
  permanentlyDeleteSpaceTrashItem,
  getSpaceTrashFolderItems,
  permanentlyDeleteSpaceTrashFolder,
  renameSpaceItem,
  restoreSpaceTrashItem,
  restoreSpaceTrashFolder,
  trashItems as trashItemsApi,
} from '../../Api';
import type { ConflictResolution, ItemConflict } from '../../Api';
import { useDeltaSync } from '../../hooks/useDeltaSync';
import type { ExplorerFolder, Role, Space, SpaceItem, TrashedFolder } from '../../types';
import { AuthenticatedImage, AuthenticatedVideo } from './AuthenticatedMedia';
import CreateFolderModal from './CreateFolderModal';
import Modal from './Modal';
import { API_BASE, EXPLORER_PAGE_SIZE, POLL_INTERVAL, TRASH_LIMIT } from '../../constants';
import { itemFileUrl, itemThumbnailUrl } from '../../utils';

interface TrashNavEntry {
  id: number;
  name: string;
  items: SpaceItem[];
  subfolders: { id: number; name: string }[];
}

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
const canMoveItemsToTrash = canWrite;
const canRestoreTrash = canWrite;

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
  const [trashFolders, setTrashFolders] = useState<TrashedFolder[]>([]);
  const [trashNavStack, setTrashNavStack] = useState<TrashNavEntry[]>([]);
  const [trashNavLoading, setTrashNavLoading] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashActionId, setTrashActionId] = useState<string | null>(null);
  const [trashOffset, setTrashOffset] = useState(0);
  const [trashHasMore, setTrashHasMore] = useState(false);
  const [trashSelectMode, setTrashSelectMode] = useState(false);
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(new Set());
  const [moveItem, setMoveItem] = useState<DeltaItem | null>(null);
  const [moveFolder, setMoveFolder] = useState<DeltaFolder | null>(null);
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
  const [copyFolder, setCopyFolder] = useState<DeltaFolder | null>(null);
  const [copyFolderTarget, setCopyFolderTarget] = useState<string>('root');
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
      if (fileIds.length > 0) {
        await trashItemsApi({ spaceId: space.id, token, itemIds: fileIds });
      }
      await Promise.all(folderIds.map((folderId) => deleteSpaceFolder({ spaceId: space.id, token, folderId })));
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      window.alert(response?.data?.error ?? `Trash failed${response?.status ? ` (${response.status})` : ''}`);
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
    const folderIds = [...selectedFolderIds];
    setBulkMoveError(null);
    try {
      setBulkMoveLoading(true);
      if (fileIds.length > 0) {
        await moveItems({ spaceId: space.id, token, itemIds: fileIds, folderId, resolutions });
      }
      await Promise.all(folderIds.map((id) => moveSpaceFolder({ spaceId: space.id, token, folderId: id, parentId: folderId })));
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

  const handleMoveFolder = (folder: DeltaFolder) => {
    setOpenMenuId(null);
    setMoveError(null);
    setMoveItem(null);
    setMoveFolder(folder);
    setMoveTargetFolder(folder.parent_id == null ? 'root' : String(folder.parent_id));
  };

  const submitMoveToFolder = async (
    e: React.FormEvent<HTMLFormElement>,
    resolutions?: Record<string, ConflictResolution>,
  ) => {
    e.preventDefault();
    if (!moveItem && !moveFolder) return;

    const folderId = moveTargetFolder === 'root' ? null : Number(moveTargetFolder);
    if (moveTargetFolder !== 'root' && !Number.isInteger(folderId)) {
      setMoveError('Invalid folder selection');
      return;
    }

    if (moveItem && folderId === moveItem.folderId && !resolutions) {
      setMoveItem(null);
      return;
    }

    if (moveFolder && folderId === moveFolder.parent_id) {
      setMoveFolder(null);
      return;
    }

    setMoveError(null);
    try {
      setMoveLoading(true);
      if (moveItem) {
        await moveItems({ spaceId: space.id, token, itemIds: [moveItem.itemId], folderId, resolutions });
      } else if (moveFolder) {
        await moveSpaceFolder({ spaceId: space.id, token, folderId: moveFolder.id, parentId: folderId });
      }
      setMoveItem(null);
      setMoveFolder(null);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { conflicts?: ItemConflict[] } } })?.response?.data;
      if (data?.conflicts) {
        setMoveItem(null);
        setMoveFolder(null);
        openConflictModal(data.conflicts, async (res) => {
          await submitMoveToFolder(e, res);
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
    setCopyTargetFolder(item.folderId == null ? 'root' : String(item.folderId));
  };

  const handleCopyFolderTo = (folder: DeltaFolder) => {
    setOpenMenuId(null);
    setCopyFolderError(null);
    setCopyFolder(folder);
    setCopyFolderTarget(folder.parent_id == null ? 'root' : String(folder.parent_id));
  };

  const submitCopyFolderTo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!copyFolder) return;
    const targetParentId = copyFolderTarget === 'root' ? null : Number(copyFolderTarget);
    if (copyFolderTarget !== 'root' && !Number.isInteger(targetParentId)) {
      setCopyFolderError('Invalid folder selection');
      return;
    }
    setCopyFolderError(null);
    try {
      setCopyFolderLoading(true);
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

  const fetchTrash = useCallback(async (offset = 0) => {
    setTrashLoading(true);
    setTrashError(null);
    try {
      const { data } = await getSpaceTrash({ spaceId: space.id, token, limit: TRASH_LIMIT, offset });
      setTrashItems((prev) => offset === 0 ? (data.items ?? []) : [...prev, ...(data.items ?? [])]);
      setTrashFolders(data.folders ?? []);
      setTrashHasMore(data.hasMore ?? false);
      setTrashOffset(offset);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Failed to load trash');
    } finally {
      setTrashLoading(false);
    }
  }, [space.id, token]);

  const handleRestoreTrashFolder = async (folder: TrashedFolder) => {
    setTrashActionId(`folder-${folder.folderId}`);
    setTrashError(null);
    try {
      await restoreSpaceTrashFolder({ spaceId: space.id, folderId: folder.folderId, token });
      setTrashFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Restore failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const handlePermanentDeleteTrashFolder = async (folder: TrashedFolder) => {
    const confirmed = window.confirm(`Permanently delete folder "${folder.name}" and all its contents?`);
    if (!confirmed) return;
    setTrashActionId(`folder-${folder.folderId}`);
    setTrashError(null);
    try {
      await permanentlyDeleteSpaceTrashFolder({ spaceId: space.id, folderId: folder.folderId, token });
      setTrashFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Permanent delete failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const openTrashFolder = async (folder: TrashedFolder) => {
    setTrashNavLoading(true);
    try {
      const { data } = await getSpaceTrashFolderItems({ spaceId: space.id, folderId: folder.folderId, token });
      setTrashNavStack([{ id: folder.folderId, name: folder.name, items: data.items ?? [], subfolders: data.folders ?? [] }]);
    } catch {
      // leave empty
    } finally {
      setTrashNavLoading(false);
    }
  };

  const openTrashSubfolder = async (sub: { id: number; name: string }) => {
    setTrashNavLoading(true);
    try {
      const { data } = await getSpaceTrashFolderItems({ spaceId: space.id, folderId: sub.id, token });
      setTrashNavStack((prev) => [...prev, { id: sub.id, name: sub.name, items: data.items ?? [], subfolders: data.folders ?? [] }]);
    } catch {
      // leave empty
    } finally {
      setTrashNavLoading(false);
    }
  };

  const handleRestoreTrashFolderItem = async (item: SpaceItem) => {
    setTrashActionId(item.itemId);
    setTrashError(null);
    try {
      await restoreSpaceTrashItem({ spaceId: space.id, itemId: item.itemId, token });
      setTrashNavStack((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1]!;
        updated[updated.length - 1] = { ...last, items: last.items.filter((i) => i.itemId !== item.itemId) };
        return updated;
      });
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Restore failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const handleRestoreTrashSubfolder = async (sub: { id: number; name: string }) => {
    setTrashActionId(`folder-${sub.id}`);
    setTrashError(null);
    try {
      await restoreSpaceTrashFolder({ spaceId: space.id, folderId: sub.id, token });
      setTrashNavStack((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1]!;
        updated[updated.length - 1] = { ...last, subfolders: last.subfolders.filter((f) => f.id !== sub.id) };
        return updated;
      });
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Restore failed');
    } finally {
      setTrashActionId(null);
    }
  };

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

  const handleBulkRestoreTrash = async () => {
    if (selectedTrashIds.size === 0) return;
    setTrashActionId('bulk');
    setTrashError(null);
    try {
      await Promise.all(
        [...selectedTrashIds].map((id) => restoreSpaceTrashItem({ spaceId: space.id, itemId: id, token }))
      );
      setTrashItems((prev) => prev.filter((item) => !selectedTrashIds.has(item.itemId)));
      setSelectedTrashIds(new Set());
      setTrashSelectMode(false);
      await refreshItems();
      await refreshFolders();
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Bulk restore failed');
    } finally {
      setTrashActionId(null);
    }
  };

  const handleBulkPermanentDelete = async () => {
    if (selectedTrashIds.size === 0) return;
    const confirmed = window.confirm(`Permanently delete ${selectedTrashIds.size} item(s)?`);
    if (!confirmed) return;
    setTrashActionId('bulk');
    setTrashError(null);
    try {
      await Promise.all(
        [...selectedTrashIds].map((id) => permanentlyDeleteSpaceTrashItem({ spaceId: space.id, itemId: id, token }))
      );
      setTrashItems((prev) => prev.filter((item) => !selectedTrashIds.has(item.itemId)));
      setSelectedTrashIds(new Set());
      setTrashSelectMode(false);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setTrashError(apiErr?.error ?? 'Bulk delete failed');
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

  useEffect(() => {
    setLikeOverrides((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const item of items) {
        const override = next[item.itemId];
        if (!override) continue;

        const serverLikedByMe = item.likedByMe ?? false;
        if (serverLikedByMe === override.likedByMe) {
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
      setLikeOverrides((prev) => ({
        ...prev,
        [item.itemId]: current,
      }));
    } finally {
      likeRequestInFlight.current.delete(item.itemId);
    }
  }, [likeOverrides, space.id, token]);

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

  const moveTargetFolderOptions = useMemo(() => {
    if (!moveFolder) return folderOptions;

    const activeFolders = allFolders.filter((folder) => !folder.deleted);
    const byId = new Map(activeFolders.map((folder) => [folder.id, folder]));
    const isSelfOrDescendant = (folderId: number): boolean => {
      if (folderId === moveFolder.id) return true;
      let current = byId.get(folderId);
      while (current?.parent_id != null) {
        if (current.parent_id === moveFolder.id) return true;
        current = byId.get(current.parent_id);
      }
      return false;
    };

    return folderOptions.filter((folder) => !isSelfOrDescendant(folder.id));
  }, [allFolders, folderOptions, moveFolder]);

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
          prev == null ? prev : Math.min(displayItems.length - 1, prev + 1),
        );
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
    const segments = breadcrumbs
      .slice(0, index + 1)
      .map((b) => encodeURIComponent(b.name));
    navigate(`/spaces/${space.id}/${segments.join('/')}`);
  };

  const navigateToRoot = () => navigate(`/spaces/${space.id}`);

  const activeItem = lightboxIndex == null ? null : (displayItems[lightboxIndex] ?? null);
  const hasPrev = lightboxIndex != null && lightboxIndex > 0;
  const hasNext = lightboxIndex != null && lightboxIndex < displayItems.length - 1;

  const loading = viewMode === 'trash' ? trashLoading : metaLoading || itemsLoading;
  const error = viewMode === 'trash' ? trashError : metaError ?? itemsError;
  const currentNavEntry = trashNavStack.length > 0 ? trashNavStack[trashNavStack.length - 1] : null;
  const isEmpty = viewMode === 'trash'
    ? currentNavEntry
      ? currentNavEntry.items.length === 0 && currentNavEntry.subfolders.length === 0
      : trashItems.length === 0 && trashFolders.length === 0
    : subfolders.length === 0 && displayItems.length === 0;

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
          {viewMode === 'files' && selectMode && totalSelected > 0 && (selectedItemIds.size > 0 ? canMoveItemsToTrash(role) : canManageTrash(role)) && (
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
              setTrashSelectMode(false);
              setSelectedTrashIds(new Set());
              setTrashNavStack([]);
            }}
          >
            {viewMode === 'trash' ? 'Back to files' : 'Trash'}
          </button>
          {viewMode === 'trash' && trashNavStack.length === 0 && (trashItems.length > 0 || trashFolders.length > 0) && (
            <button onClick={() => { setTrashSelectMode((p) => !p); setSelectedTrashIds(new Set()); }}>
              {trashSelectMode ? 'Cancel' : 'Select'}
            </button>
          )}
          {viewMode === 'trash' && trashNavStack.length === 0 && trashSelectMode && selectedTrashIds.size > 0 && canRestoreTrash(role) && (
            <button onClick={() => { void handleBulkRestoreTrash(); }} disabled={trashActionId !== null}>
              Restore ({selectedTrashIds.size})
            </button>
          )}
          {viewMode === 'trash' && trashNavStack.length === 0 && trashSelectMode && selectedTrashIds.size > 0 && canManageTrash(role) && (
            <button className="space-explorer__trash-danger" onClick={() => { void handleBulkPermanentDelete(); }} disabled={trashActionId !== null}>
              Delete forever ({selectedTrashIds.size})
            </button>
          )}
          {viewMode === 'trash' && trashNavStack.length === 0 && !trashSelectMode && canManageTrash(role) && (trashItems.length > 0 || trashFolders.length > 0) && (
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

      {viewMode === 'trash' && trashNavStack.length === 0 && (
        <p className="space-explorer__message">
          Trashed items are permanently deleted after 7 days.
        </p>
      )}
      {viewMode === 'trash' && trashNavStack.length > 0 && (
        <p className="space-explorer__message" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setTrashNavStack([])}>← Trash</button>
          {trashNavStack.map((entry, i) => (
            <span key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span className="space-explorer__breadcrumb-sep">/</span>
              {i < trashNavStack.length - 1 ? (
                <button type="button" onClick={() => setTrashNavStack((prev) => prev.slice(0, i + 1))}>
                  📁 {entry.name}
                </button>
              ) : (
                <span>📁 {entry.name}</span>
              )}
            </span>
          ))}
          {trashNavLoading && <span>Loading…</span>}
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
        {viewMode === 'trash' && currentNavEntry && (
          <div className="space-explorer__grid">
            {currentNavEntry.items.length === 0 && currentNavEntry.subfolders.length === 0 && !trashNavLoading && (
              <p className="space-explorer__message">This folder is empty.</p>
            )}
            {currentNavEntry.subfolders.map((sub) => (
              <div key={`tsub-${sub.id}`} className="space-explorer__tile-wrap">
                <button
                  type="button"
                  className="space-explorer__tile--folder"
                  onClick={() => { void openTrashSubfolder(sub); }}
                  title={`Open ${sub.name}`}
                >
                  <span className="space-explorer__folder-icon">📁</span>
                  <span className="space-explorer__folder-name">{sub.name}</span>
                </button>
                <div className="space-explorer__trash-actions">
                  {canRestoreTrash(role) && (
                    <button
                      type="button"
                      onClick={() => { void handleRestoreTrashSubfolder(sub); }}
                      disabled={trashActionId !== null}
                    >
                      {trashActionId === `folder-${sub.id}` ? 'Working…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {currentNavEntry.items.map((item) => (
              <div key={item.itemId} className="space-explorer__tile-wrap">
                <div className="space-explorer__tile--item">
                  <button type="button" className="space-explorer__tile-btn" title={item.displayName}>
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
                  {canRestoreTrash(role) && (
                    <button
                      type="button"
                      onClick={() => { void handleRestoreTrashFolderItem(item); }}
                      disabled={trashActionId !== null}
                    >
                      {trashActionId === item.itemId ? 'Working…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'trash' && !currentNavEntry && (trashItems.length > 0 || trashFolders.length > 0) && (
          <div className="space-explorer__grid">
            {trashFolders.map((folder) => (
              <div key={`tf-${folder.folderId}`} className="space-explorer__tile-wrap">
                <button
                  type="button"
                  className="space-explorer__tile--folder"
                  onClick={() => { void openTrashFolder(folder); }}
                  title={`Open ${folder.name}`}
                >
                  <span className="space-explorer__folder-icon">📁</span>
                  <span className="space-explorer__folder-name">{folder.name}</span>
                </button>
                <div className="space-explorer__trash-actions">
                  <span className="space-explorer__trash-meta">
                    {formatRemainingTrashTime(folder.expiresAt)}
                  </span>
                  {canRestoreTrash(role) && (
                    <button
                      type="button"
                      onClick={() => { void handleRestoreTrashFolder(folder); }}
                      disabled={trashActionId !== null}
                    >
                      {trashActionId === `folder-${folder.folderId}` ? 'Working…' : 'Restore all'}
                    </button>
                  )}
                  {canManageTrash(role) && (
                    <button
                      type="button"
                      className="space-explorer__trash-danger"
                      onClick={() => { void handlePermanentDeleteTrashFolder(folder); }}
                      disabled={trashActionId !== null}
                    >
                      Delete forever
                    </button>
                  )}
                </div>
              </div>
            ))}
            {trashItems.map((item) => (
              <div
                key={item.itemId}
                className={`space-explorer__tile-wrap${trashSelectMode && selectedTrashIds.has(item.itemId) ? ' space-explorer__tile-wrap--selected' : ''}`}
              >
                <div className="space-explorer__tile--item">
                  <button
                    type="button"
                    className="space-explorer__tile-btn"
                    title={item.displayName}
                    onClick={trashSelectMode ? () => {
                      setSelectedTrashIds((prev) => {
                        const next = new Set(prev);
                        next.has(item.itemId) ? next.delete(item.itemId) : next.add(item.itemId);
                        return next;
                      });
                    } : undefined}
                  >
                    {trashSelectMode && (
                      <span className="space-explorer__select-check">
                        {selectedTrashIds.has(item.itemId) ? '☑' : '☐'}
                      </span>
                    )}
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
                  {!trashSelectMode && (canRestoreTrash(role) || canManageTrash(role)) && (
                    <>
                      {canRestoreTrash(role) && (
                        <button
                          type="button"
                          onClick={() => { void handleRestoreTrashItem(item); }}
                          disabled={trashActionId !== null}
                        >
                          {trashActionId === item.itemId ? 'Working…' : 'Restore'}
                        </button>
                      )}
                      {canManageTrash(role) && (
                        <button
                          type="button"
                          className="space-explorer__trash-danger"
                          onClick={() => { void handlePermanentDeleteTrashItem(item); }}
                          disabled={trashActionId !== null}
                        >
                          Delete forever
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'files' && (subfolders.length > 0 || displayItems.length > 0) && (
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
                {!selectMode && canWrite(role) && (
                  <button
                    type="button"
                    className="space-explorer__menu-btn"
                    aria-label="Folder options"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId !== `folder-${folder.id}` ? `folder-${folder.id}` : null);
                    }}
                  >
                    ⋮
                  </button>
                )}

                {openMenuId === `folder-${folder.id}` && (
                  <div className="space-explorer__menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { handleMoveFolder(folder); }}
                    >Move to folder</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item"
                      onClick={() => { handleCopyFolderTo(folder); }}
                    >Copy to folder</button>
                    <button
                      type="button"
                      className="space-explorer__menu-item space-explorer__menu-item--danger"
                      onClick={() => { void handleDeleteFolder(folder); }}
                    >Move to trash</button>
                  </div>
                )}
              </div>
            ))}

            {displayItems.map((item, index) => (
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
                  {!selectMode && (
                    <button
                      type="button"
                      className={`space-explorer__like-btn ${item.likedByMe ? 'space-explorer__like-btn--active' : ''}`}
                      aria-label={`${item.likedByMe ? 'Unlike' : 'Like'} ${item.displayName}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleLikeItem(item);
                      }}
                    >
                      <span aria-hidden="true">♥</span>
                      <span>{item.likeCount}</span>
                    </button>
                  )}
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
                    {canMoveItemsToTrash(role) && (
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
                    prev == null ? prev : Math.min(displayItems.length - 1, prev + 1),
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
                className={`space-explorer__lightbox-like ${activeItem.likedByMe ? 'space-explorer__lightbox-like--active' : ''}`}
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

      {bulkMoveOpen && (
        <Modal
          title={<>Move {totalSelected} selected</>}
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

      {(moveItem || moveFolder) && (
        <Modal
          title={
            <>
              Move <span className="modal__title-accent">{moveItem?.displayName ?? moveFolder?.name}</span>
            </>
          }
          onClose={() => {
            if (!moveLoading) {
              setMoveItem(null);
              setMoveFolder(null);
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
              {moveTargetFolderOptions.map((folder) => (
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

      {copyFolder && (
        <Modal
          title={<>Copy <span className="modal__title-accent">{copyFolder.name}</span></>}
          onClose={() => { if (!copyFolderLoading) { setCopyFolder(null); setCopyFolderError(null); } }}
        >
          <form className="modal__form" onSubmit={(e) => { void submitCopyFolderTo(e); }}>
            <select
              className="modal__input"
              value={copyFolderTarget}
              onChange={(e) => setCopyFolderTarget(e.target.value)}
              disabled={copyFolderLoading}
            >
              <option value="root">Root (no folder)</option>
              {folderOptions.map((f) => (
                <option key={f.id} value={String(f.id)}>{f.label}</option>
              ))}
            </select>
            <button type="submit" className="modal__btn modal__btn--primary modal__btn--full" disabled={copyFolderLoading}>
              {copyFolderLoading ? 'Copying…' : 'Copy'}
            </button>
            {copyFolderError && <p className="modal__error">{copyFolderError}</p>}
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
