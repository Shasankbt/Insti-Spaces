/**
 * Merge an incoming delta (array of rows) into an existing id-keyed map.
 * Rows with deleted=true are removed; everything else is upserted.
 * Returns a NEW map reference so React state updates correctly.
 */
export function applyDelta(currentMap, rows, idKey = 'id') {
  const next = { ...currentMap };
  for (const row of rows) {
    const key = row[idKey];
    if (row.deleted) {
      delete next[key];
    } else {
      next[key] = row;
    }
  }
  return next;
}

/**
 * Fetch a delta from `url` for rows newer than `since`.
 * Returns { rows, newSince } on 200, or null on 304 / empty.
 */
export async function fetchDelta(url, since, token) {
  const params = new URLSearchParams({ since: since.toISOString() });
  const res = await fetch(`${url}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 304 || res.status === 204) return null;
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);

  const body = await res.json();
  // pick whichever key your endpoint returns
  const rows = body.spaces ?? body.members ?? body.items ?? body.friends ?? [];
  if (rows.length === 0) return null;

  // high-water mark from server timestamps — never Date.now()
  const newSince = rows.reduce((max, r) => {
    const t = new Date(r.updated_at ?? r.created_at);
    return t > max ? t : max;
  }, since);

  return { rows, newSince };
}
