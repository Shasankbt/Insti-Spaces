import { useEffect, useRef, useCallback, useReducer } from 'react';
import { fetchDelta, fetchPage, applyDelta } from '../utils';
import { DELTA_SYNC_FALLBACK_INTERVAL_MS } from '../timings';

const EPOCH = new Date(0);

interface SyncState<T> {
  dataMap: Record<string | number, T>;
  since: Date;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
}

type SyncAction<T> =
  | { type: 'MERGE'; rows: T[]; since: Date }
  | { type: 'MERGE_PAGE'; rows: T[]; nextCursor: string | null }
  | { type: 'REMOVE'; ids: ReadonlyArray<string | number> }
  | { type: 'RESET' }
  | { type: 'ERROR'; error: string }
  | { type: 'LOADING'; value: boolean };

function makeReducer<T extends { deleted?: boolean }>(idKey: keyof T) {
  return function reducer(state: SyncState<T>, action: SyncAction<T>): SyncState<T> {
    switch (action.type) {
      case 'MERGE':
        return {
          ...state,
          dataMap: applyDelta(state.dataMap, action.rows, idKey),
          since: action.since,
          loading: false,
          error: null,
        };
      case 'MERGE_PAGE': {
        // Advance since to the newest updated_at seen in this page (never go backwards).
        const pageSince = action.rows.reduce((max, r) => {
          const row = r as { updated_at?: string; uploaded_at?: string };
          const t = new Date((row.updated_at ?? row.uploaded_at ?? '') as string);
          return t > max ? t : max;
        }, state.since);
        return {
          ...state,
          dataMap: applyDelta(state.dataMap, action.rows, idKey),
          since: pageSince,
          nextCursor: action.nextCursor,
          loading: false,
          error: null,
        };
      }
      case 'REMOVE': {
        if (action.ids.length === 0) return state;
        let changed = false;
        const next: Record<string | number, T> = { ...state.dataMap };
        for (const id of action.ids) {
          if (id in next) { delete next[id]; changed = true; }
        }
        return changed ? { ...state, dataMap: next } : state;
      }
      case 'RESET':
        return { ...state, dataMap: {}, since: EPOCH, nextCursor: null, loading: true };
      case 'ERROR':
        return { ...state, error: action.error, loading: false };
      case 'LOADING':
        return { ...state, loading: action.value };
      default:
        return state;
    }
  };
}

interface UseDeltaSyncOptions {
  token?: string | null;
  interval?: number;
  pause?: boolean;
  idKey?: string;
  pageSize?: number;
}

interface UseDeltaSyncResult<T> {
  data: T[];
  dataMap: Record<string | number, T>;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  sync: () => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Locally drop rows by id (no network). Use after a confirmed mutation
   *  to skip a full grid refetch — the next delta sync will reconcile. */
  removeIds: (ids: ReadonlyArray<string | number>) => void;
}

export function useDeltaSync<T extends object>(
  url: string,
  { token, interval = DELTA_SYNC_FALLBACK_INTERVAL_MS, pause = false, idKey = 'id', pageSize }: UseDeltaSyncOptions = {},
): UseDeltaSyncResult<T> {
  const reducerRef = useRef<ReturnType<typeof makeReducer<T>> | null>(null);
  if (!reducerRef.current) reducerRef.current = makeReducer<T>(idKey as keyof T);

  const [state, dispatch] = useReducer(reducerRef.current, {
    dataMap: {} as Record<string | number, T>,
    since: EPOCH,
    loading: true,
    error: null,
    nextCursor: null,
  });

  const sinceRef = useRef<Date>(EPOCH);
  sinceRef.current = state.since;
  const nextCursorRef = useRef<string | null>(null);
  nextCursorRef.current = state.nextCursor;

  const sync = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const result = await fetchDelta<T>(url, sinceRef.current, token);
      if (!result) {
        dispatch({ type: 'LOADING', value: false });
        return;
      }
      dispatch({ type: 'MERGE', rows: result.rows, since: result.newSince });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      dispatch({ type: 'ERROR', error: message });
    }
  }, [url, token]);

  const loadInitial = useCallback(async (): Promise<void> => {
    if (!token || !pageSize) return;
    dispatch({ type: 'RESET' });
    try {
      const result = await fetchPage<T>(url, token, { limit: String(pageSize) });
      dispatch({ type: 'MERGE_PAGE', rows: result.rows, nextCursor: result.nextCursor });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      dispatch({ type: 'ERROR', error: message });
    }
  }, [url, token, pageSize]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    if (pageSize) {
      dispatch({ type: 'RESET' });
      try {
        const result = await fetchPage<T>(url, token, { limit: String(pageSize) });
        dispatch({ type: 'MERGE_PAGE', rows: result.rows, nextCursor: result.nextCursor });
      } catch (err: unknown) {
        dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Unknown sync error' });
      }
    } else {
      sinceRef.current = EPOCH;
      dispatch({ type: 'RESET' });
      try {
        const result = await fetchDelta<T>(url, EPOCH, token);
        if (!result) { dispatch({ type: 'LOADING', value: false }); return; }
        dispatch({ type: 'MERGE', rows: result.rows, since: result.newSince });
      } catch (err: unknown) {
        dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Unknown sync error' });
      }
    }
  }, [url, token, pageSize]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!token || !pageSize || !nextCursorRef.current) return;
    try {
      const result = await fetchPage<T>(url, token, {
        limit: String(pageSize),
        cursor: nextCursorRef.current,
      });
      dispatch({ type: 'MERGE_PAGE', rows: result.rows, nextCursor: result.nextCursor });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      dispatch({ type: 'ERROR', error: message });
    }
  }, [url, token, pageSize]);

  // initial fetch + polling
  useEffect(() => {
    if (pause) return;
    if (pageSize) {
      void loadInitial();
    } else {
      void sync();
    }
    const id = setInterval(() => void sync(), interval);
    return () => clearInterval(id);
  }, [sync, loadInitial, interval, pause, pageSize]);

  // re-sync when tab becomes visible
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  const removeIds = useCallback((ids: ReadonlyArray<string | number>) => {
    dispatch({ type: 'REMOVE', ids });
  }, []);

  const data = Object.values(state.dataMap);

  return {
    data,
    dataMap: state.dataMap,
    loading: state.loading,
    error: state.error,
    nextCursor: state.nextCursor,
    sync,
    refresh,
    loadMore,
    removeIds,
  };
}
