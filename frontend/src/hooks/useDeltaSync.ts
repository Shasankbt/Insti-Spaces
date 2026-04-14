import { useEffect, useRef, useCallback, useReducer } from 'react';
import { fetchDelta, applyDelta } from '../utils';

const EPOCH = new Date(0);

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
    switch (action.type) {
      case 'MERGE':
        return {
          ...state,
          dataMap: applyDelta(state.dataMap, action.rows, idKey),
          since: action.since,
          loading: false,
          error: null,
        };
      case 'RESET':
        return { ...state, dataMap: {}, since: EPOCH, loading: true };
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

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
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

  // re-sync when tab becomes visible
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
