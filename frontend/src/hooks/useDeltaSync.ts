/// <reference types="vite/client" />
import { useEffect, useRef, useCallback, useReducer } from 'react';
import { fetchDelta, applyDelta } from '../utils';

const EPOCH = new Date(0);
const LOG_PREFIX = '[useDeltaSync]';

function logDeltaSync(event: string, meta: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  // console.debug(`${LOG_PREFIX} ${event}`, meta);
}

interface SyncState<T> {
  dataMap: Record<string | number, T>;
  since: Date;
  loading: boolean;
  error: string | null;
}

type SyncAction<T> =
  | { type: 'MERGE'; rows: T[]; since: Date }
  | { type: 'RESET' }
  | { type: 'ERROR'; error: string }
  | { type: 'LOADING'; value: boolean };

function makeReducer<T extends { deleted?: boolean }>(idKey: keyof T) {
  return function reducer(state: SyncState<T>, action: SyncAction<T>): SyncState<T> {
    logDeltaSync(`reducer:${action.type}`, {
      idKey: String(idKey),
      since: state.since?.toISOString?.(),
      currentCount: Object.keys(state.dataMap).length,
    });

    switch (action.type) {
      case 'MERGE':
        logDeltaSync('case:MERGE', {
          rows: Array.isArray(action.rows) ? action.rows.length : 0,
          nextSince: action.since?.toISOString?.(),
        });
        return {
          ...state,
          dataMap: applyDelta(state.dataMap, action.rows, idKey),
          since: action.since,
          loading: false,
          error: null,
        };
      case 'RESET':
        logDeltaSync('case:RESET', { reason: 'manual refresh/full reset' });
        return { ...state, dataMap: {}, since: EPOCH, loading: true };
      case 'ERROR':
        logDeltaSync('case:ERROR', { error: action.error });
        return { ...state, error: action.error, loading: false };
      case 'LOADING':
        logDeltaSync('case:LOADING', { loading: action.value });
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
}

interface UseDeltaSyncResult<T> {
  data: T[];
  dataMap: Record<string | number, T>;
  loading: boolean;
  error: string | null;
  sync: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDeltaSync<T extends object>(
  url: string,
  { token, interval = 15_000, pause = false, idKey = 'id' }: UseDeltaSyncOptions = {},
): UseDeltaSyncResult<T> {
  const reducerRef = useRef<ReturnType<typeof makeReducer<T>> | null>(null);
  if (!reducerRef.current) reducerRef.current = makeReducer<T>(idKey as keyof T);

  const [state, dispatch] = useReducer(reducerRef.current, {
    dataMap: {} as Record<string | number, T>,
    since: EPOCH,
    loading: true,
    error: null,
  });

  const sinceRef = useRef<Date>(EPOCH);
  sinceRef.current = state.since;

  const sync = useCallback(async (): Promise<void> => {
    if (!token) {
      logDeltaSync('sync:skipped', { reason: 'missing token' });
      return;
    }

    logDeltaSync('sync:start', {
      url,
      since: sinceRef.current?.toISOString?.(),
    });

    try {
      const result = await fetchDelta<T>(url, sinceRef.current, token);
      if (!result) {
        dispatch({ type: 'LOADING', value: false });
        return;
      }
      dispatch({ type: 'MERGE', rows: result.rows, since: result.newSince });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      logDeltaSync('sync:error', { error: message });
      dispatch({ type: 'ERROR', error: message });
    }
  }, [url, token]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) {
      logDeltaSync('refresh:skipped', { reason: 'missing token' });
      return;
    }

    logDeltaSync('refresh:start', { url });

    sinceRef.current = EPOCH;
    dispatch({ type: 'RESET' });
    try {
      const result = await fetchDelta<T>(url, EPOCH, token);
      if (!result) {
        dispatch({ type: 'LOADING', value: false });
        return;
      }
      dispatch({ type: 'MERGE', rows: result.rows, since: result.newSince });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      logDeltaSync('refresh:error', { error: message });
      dispatch({ type: 'ERROR', error: message });
    }
  }, [url, token]);

  // initial fetch + polling
  useEffect(() => {
    if (pause) return;
    void sync();
    const id = setInterval(() => void sync(), interval);
    return () => clearInterval(id);
  }, [sync, interval, pause]);

  // pause when tab is hidden
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  const data = Object.values(state.dataMap);

  return { data, dataMap: state.dataMap, loading: state.loading, error: state.error, sync, refresh };
}
