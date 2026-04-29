import { useCallback, useEffect, useState } from 'react';
import {
  emptySpaceTrash,
  getSpaceTrash,
  getSpaceTrashFolderItems,
  permanentlyDeleteSpaceTrashFolder,
  permanentlyDeleteSpaceTrashItem,
  restoreSpaceTrashFolder,
  restoreSpaceTrashItem,
} from '../../Api';
import type { Role, Space, SpaceItem, TrashedFolder } from '../../types';
import { AuthenticatedImage } from './AuthenticatedMedia';
import { itemThumbnailUrl } from '../../utils';
import { TRASH_LIMIT } from '../../constants';

interface TrashNavEntry {
  id: number;
  name: string;
  items: SpaceItem[];
  subfolders: { id: number; name: string }[];
}

interface SpaceTrashProps {
  space: Space;
  token: string;
  role: Role;
}

const canManageTrash = (role: Role) => ['moderator', 'admin'].includes(role);
const canRestoreTrash = (role: Role) => ['contributor', 'moderator', 'admin'].includes(role);

const formatRemainingTrashTime = (expiresAt?: string | null): string => {
  if (!expiresAt) return 'Expires after 7 days';
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return 'Expires soon';
  const days = Math.floor(remainingMs / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.max(1, Math.ceil(remainingMs / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
};

export default function SpaceTrash({ space, token, role }: SpaceTrashProps) {
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

  useEffect(() => {
    void fetchTrash(0);
  }, [fetchTrash]);

  const handleRestoreTrashFolder = async (folder: TrashedFolder) => {
    setTrashActionId(`folder-${folder.folderId}`);
    setTrashError(null);
    try {
      await restoreSpaceTrashFolder({ spaceId: space.id, folderId: folder.folderId, token });
      setTrashFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
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

  const currentNavEntry = trashNavStack.length > 0 ? trashNavStack[trashNavStack.length - 1] : null;
  const isEmpty = currentNavEntry
    ? currentNavEntry.items.length === 0 && currentNavEntry.subfolders.length === 0
    : trashItems.length === 0 && trashFolders.length === 0;

  return (
    <section className="space-explorer">
      <div className="space-explorer__header">
        <div className="space-explorer__toolbar">
          <button
            className="explorer-toolbar__icon-btn"
            title={trashLoading ? 'Refreshing…' : 'Refresh'}
            disabled={trashLoading}
            onClick={() => { void fetchTrash(0); }}
          >
            ↻
          </button>
          {trashNavStack.length === 0 && (trashItems.length > 0 || trashFolders.length > 0) && (
            <button
              className={`explorer-toolbar__icon-btn${trashSelectMode ? ' explorer-toolbar__icon-btn--active' : ''}`}
              title={trashSelectMode ? 'Exit selection' : 'Select items'}
              onClick={() => { setTrashSelectMode((p) => !p); setSelectedTrashIds(new Set()); }}
            >
              {trashSelectMode ? '✕' : '☑'}
            </button>
          )}
          {trashNavStack.length === 0 && trashSelectMode && selectedTrashIds.size > 0 && canRestoreTrash(role) && (
            <button
              className="explorer-toolbar__icon-btn"
              title={`Restore ${selectedTrashIds.size} selected`}
              onClick={() => { void handleBulkRestoreTrash(); }}
              disabled={trashActionId !== null}
            >
              ↩
            </button>
          )}
          {trashNavStack.length === 0 && trashSelectMode && selectedTrashIds.size > 0 && canManageTrash(role) && (
            <button
              className="explorer-toolbar__icon-btn explorer-toolbar__icon-btn--danger"
              title={`Delete forever ${selectedTrashIds.size} selected`}
              onClick={() => { void handleBulkPermanentDelete(); }}
              disabled={trashActionId !== null}
            >
              🗑
            </button>
          )}
          {trashNavStack.length === 0 && !trashSelectMode && canManageTrash(role) && (trashItems.length > 0 || trashFolders.length > 0) && (
            <button
              className="explorer-toolbar__icon-btn explorer-toolbar__icon-btn--danger"
              title="Empty trash"
              onClick={() => { void handleEmptyTrash(); }}
              disabled={trashActionId === 'empty'}
            >
              {trashActionId === 'empty' ? '…' : '⊘'}
            </button>
          )}
        </div>
      </div>

      {trashNavStack.length === 0 && (
        <p className="space-explorer__message">
          Trashed items are permanently deleted after 7 days.
        </p>
      )}
      {trashNavStack.length > 0 && (
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

      {trashLoading && isEmpty && <p className="space-explorer__message">Loading…</p>}
      {trashError && <p className="space-explorer__message space-explorer__message--error">{trashError}</p>}
      {!trashLoading && !trashError && isEmpty && (
        <p className="space-explorer__message">Trash is empty.</p>
      )}

      <div className="space-explorer__body">
        {currentNavEntry && (
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
                <span className="space-explorer__item-name">{item.displayName}</span>
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

        {!currentNavEntry && (trashItems.length > 0 || trashFolders.length > 0) && (
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
                <span className="space-explorer__item-name">{item.displayName}</span>
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

        {trashHasMore && (
          <button
            className="space-explorer__load-more"
            onClick={() => void fetchTrash(trashOffset + TRASH_LIMIT)}
            disabled={trashLoading}
          >
            {trashLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </section>
  );
}
