import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSpaceDuplicates, getSpaceSimilars, trashItems as trashItemsApi } from '../../Api';
import type { Space, SpaceHashGroup } from '../../types';
import { AuthenticatedImage } from './AuthenticatedMedia';
import { itemThumbnailUrl } from '../../utils';

type CleanupMode = 'duplicates' | 'similars';

interface SpaceHashCleanupProps {
  space: Space;
  token: string;
  mode: CleanupMode;
}

const modeConfig: Record<CleanupMode, {
  title: string;
  emptyText: string;
  refreshLabel: string;
}> = {
  duplicates: {
    title: 'Duplicates',
    emptyText: 'No duplicate groups found.',
    refreshLabel: 'Refresh duplicates',
  },
  similars: {
    title: 'Similars',
    emptyText: 'No similar groups found.',
    refreshLabel: 'Refresh similars',
  },
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const getGroupFetch = (mode: CleanupMode) =>
  mode === 'duplicates' ? getSpaceDuplicates : getSpaceSimilars;

export default function SpaceHashCleanup({ space, token, mode }: SpaceHashCleanupProps) {
  const config = modeConfig[mode];
  const fetchGroups = useMemo(() => getGroupFetch(mode), [mode]);
  const [groups, setGroups] = useState<SpaceHashGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionHash, setActionHash] = useState<string | null>(null);
  const [keepers, setKeepers] = useState<Record<string, string[]>>({});

  const refreshGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await fetchGroups({ spaceId: space.id, token });
      const nextGroups = [...(data.groups ?? [])].map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()),
      }));
      setGroups(nextGroups);
      setKeepers((prev) => {
        const next: Record<string, string[]> = {};
        for (const group of nextGroups) {
          const existingKeeper = prev[group.hash];
          if (existingKeeper && existingKeeper.some((id) => group.items.some((item) => item.itemId === id))) {
            // preserve only ids that still exist in the refreshed group
            next[group.hash] = existingKeeper.filter((id) => group.items.some((item) => item.itemId === id));
            if (next[group.hash].length > 0) continue;
          }
          next[group.hash] = group.items[0] ? [group.items[0].itemId] : [];
        }
        return next;
      });
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? `Failed to load ${config.title.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [config.title, fetchGroups, space.id, token]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  const toggleKeeper = (hash: string, itemId: string) => {
    setKeepers((prev) => {
      const current = prev[hash] ?? [];
      const exists = current.includes(itemId);
      const nextForHash = exists ? current.filter((id) => id !== itemId) : [...current, itemId];
      const next = { ...prev } as Record<string, string[]>;
      if (nextForHash.length === 0) delete next[hash];
      else next[hash] = nextForHash;
      return next;
    });
  };

  const handleTrashOthers = async (group: SpaceHashGroup) => {
    const keeperIds = (keepers[group.hash] && keepers[group.hash].length > 0) ? keepers[group.hash] : (group.items[0] ? [group.items[0].itemId] : []);
    if (keeperIds.length === 0) return;
    const itemIds = group.items.filter((item) => !keeperIds.includes(item.itemId)).map((item) => item.itemId);
    if (itemIds.length === 0) return;

    const confirmed = window.confirm(
      `Move ${itemIds.length} duplicate${itemIds.length === 1 ? '' : 's'} to trash and keep one copy?`,
    );
    if (!confirmed) return;

    setActionHash(group.hash);
    setError(null);
    try {
      await trashItemsApi({ spaceId: space.id, token, itemIds });
      setGroups((prev) => prev.filter((current) => current.hash !== group.hash));
      setKeepers((prev) => {
        const next = { ...prev } as Record<string, string[]>;
        delete next[group.hash];
        return next;
      });
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Failed to trash duplicates');
    } finally {
      setActionHash(null);
    }
  };

  const totalGroups = groups.length;
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  const wastedBytes = groups.reduce((sum, group) => sum + group.wastedBytes, 0);

  return (
    <section className="space-hash-cleanup">
      <div className="space-hash-cleanup__header">
        <div>
          <h3 className="space-hash-cleanup__title">{config.title}</h3>
        </div>
        <button className="space-hash-cleanup__refresh" type="button" onClick={() => { void refreshGroups(); }} disabled={loading}>
          {loading ? 'Refreshing…' : config.refreshLabel}
        </button>
      </div>

      <div className="space-hash-cleanup__summary">
        {totalGroups} group{totalGroups === 1 ? '' : 's'} · {totalItems} items · {formatBytes(wastedBytes)} reclaimable
      </div>

      {error && <p className="space-hash-cleanup__error">{error}</p>}

      {!loading && groups.length === 0 && <p className="space-hash-cleanup__empty">{config.emptyText}</p>}

      <div className="space-hash-cleanup__groups">
        {groups.map((group) => {
          const selectedIds = keepers[group.hash] ?? (group.items[0] ? [group.items[0].itemId] : []);
          const selectedCount = selectedIds.length;
          const keepLabel = selectedCount === 1 ? (group.items.find((item) => item.itemId === selectedIds[0])?.displayName ?? 'one selected copy') : `${selectedCount} copies`;
          return (
            <article key={group.hash} className="space-hash-cleanup__group">
              <div className="space-hash-cleanup__group-head">
                <div>
                  <h4 className="space-hash-cleanup__group-title">{group.items.length} copies</h4>
                  <p className="space-hash-cleanup__group-meta">
                    {formatBytes(group.totalSizeBytes)} total · {formatBytes(group.wastedBytes)} wasted · keep {keepLabel}
                  </p>
                </div>
                <div className="space-hash-cleanup__group-actions">
                  <button type="button" className="space-hash-cleanup__action" onClick={() => {
                    const id = group.items[0]?.itemId;
                    if (id) setKeepers((prev) => ({ ...prev, [group.hash]: Array.from(new Set([...(prev[group.hash] ?? []), id])) }));
                  }}>
                    Keep oldest
                  </button>
                  <button type="button" className="space-hash-cleanup__action" onClick={() => {
                    const id = group.items[group.items.length - 1]?.itemId;
                    if (id) setKeepers((prev) => ({ ...prev, [group.hash]: Array.from(new Set([...(prev[group.hash] ?? []), id])) }));
                  }}>
                    Keep newest
                  </button>
                  <button
                    type="button"
                    className="space-hash-cleanup__action space-hash-cleanup__action--danger"
                    onClick={() => { void handleTrashOthers(group); }}
                    disabled={actionHash === group.hash}
                  >
                    {actionHash === group.hash ? 'Working…' : 'Trash others'}
                  </button>
                </div>
              </div>

              <div className="space-hash-cleanup__items">
                {group.items.map((item) => {
                  const selected = (keepers[group.hash] ?? []).includes(item.itemId);
                  return (
                    <button
                      key={item.itemId}
                      type="button"
                      className={`space-hash-cleanup__item${selected ? ' space-hash-cleanup__item--selected' : ''}`}
                      onClick={() => toggleKeeper(group.hash, item.itemId)}
                    >
                      <span className="space-hash-cleanup__item-radio" aria-hidden="true">
                        {selected ? '☑' : '☐'}
                      </span>
                      <AuthenticatedImage
                        src={itemThumbnailUrl(space.id, item.itemId)}
                        token={token}
                        alt={item.displayName}
                        loading="lazy"
                        className="space-hash-cleanup__thumb"
                      />
                      <span className="space-hash-cleanup__item-body">
                        <span className="space-hash-cleanup__item-path" title={item.path}>{item.path}</span>
                        <span className="space-hash-cleanup__item-meta">
                          {item.uploadedBy} · {formatDate(item.uploadedAt)} · {formatBytes(item.sizeBytes)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}