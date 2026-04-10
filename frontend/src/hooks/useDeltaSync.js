import { useEffect, useRef, useCallback, useReducer } from 'react';
import { fetchDelta, applyDelta } from '../utils';

const EPOCH = new Date(0);
const LOG_PREFIX = '[useDeltaSync]';

function logDeltaSync(event, meta = {}) {
  if (!import.meta.env.DEV) return;
  console.debug(`${LOG_PREFIX} ${event}`, meta);
}

function makeReducer(idKey) {
  return function reducer(state, action) {
    logDeltaSync(`reducer:${action.type}`, {
      idKey,
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
      default: return state;
    }
  };
}

/**
 * @param {string}  url             – endpoint, e.g. 'http://localhost:3000/api/spaces'
 * @param {object}  opts
 * @param {string}  opts.token      – bearer token
 * @param {number}  [opts.interval] – poll ms, default 15000
 * @param {boolean} [opts.pause]    – stop polling when true
 * @param {string}  [opts.idKey]    – row field used as map key, default 'id'
 */
export function useDeltaSync(url, { token, interval = 15_000, pause = false, idKey = 'id' } = {}) {
  const reducerRef = useRef(null);
  if (!reducerRef.current) reducerRef.current = makeReducer(idKey);

  const [state, dispatch] = useReducer(reducerRef.current, {
    dataMap: {},
    since: EPOCH,
    loading: true,
    error: null,
  });

  const sinceRef = useRef(EPOCH);
  sinceRef.current = state.since;

  const sync = useCallback(async () => {
    if (!token) {
      logDeltaSync('sync:skipped', { reason: 'missing token' });
      return;
    }

    logDeltaSync('sync:start', {
      url,
      since: sinceRef.current?.toISOString?.(),
    });

    try {
      const result = await fetchDelta(url, sinceRef.current, token);
      if (!result) { dispatch({ type: 'LOADING', value: false }); return; }
      dispatch({ type: 'MERGE', rows: result.rows, since: result.newSince });
    } catch (err) {
      logDeltaSync('sync:error', { error: err.message });
      dispatch({ type: 'ERROR', error: err.message });
    }
  }, [url, token]);

  // Full reset: clears the map and re-fetches from epoch.
  // Use this after mutations that can remove items (accept/reject actions).
  const refresh = useCallback(async () => {
    if (!token) {
      logDeltaSync('refresh:skipped', { reason: 'missing token' });
      return;
    }

    logDeltaSync('refresh:start', { url });

    sinceRef.current = EPOCH;
    dispatch({ type: 'RESET' });
    try {
      const result = await fetchDelta(url, EPOCH, token);
      if (!result) { dispatch({ type: 'LOADING', value: false }); return; }
      dispatch({ type: 'MERGE', rows: result.rows, since: result.newSince });
    } catch (err) {
      logDeltaSync('refresh:error', { error: err.message });
      dispatch({ type: 'ERROR', error: err.message });
    }
  }, [url, token]);

  // initial fetch + polling
  useEffect(() => {
    if (pause) return;
    sync();
    const id = setInterval(sync, interval);
    return () => clearInterval(id);
  }, [sync, interval, pause]);

  // pause when tab is hidden (saves requests)
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  const data = Object.values(state.dataMap);

  return { data, dataMap: state.dataMap, loading: state.loading, error: state.error, sync, refresh };
}
