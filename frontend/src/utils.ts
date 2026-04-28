import { API_BASE } from './constants';

export const itemFileUrl = (spaceId: number | string, itemId: string): string =>
  `${API_BASE}/spaces/${spaceId}/items/${itemId}/file`;

export const itemThumbnailUrl = (spaceId: number | string, itemId: string): string =>
  `${API_BASE}/spaces/${spaceId}/items/${itemId}/thumbnail`;

/**
 * Merge an incoming delta (array of rows) into an existing id-keyed map.
 * Rows with deleted=true are removed; everything else is upserted.
 * Returns a NEW map reference so React state updates correctly.
 */
export function applyDelta<T extends object>(
  currentMap: Record<string | number, T>,
  rows: T[],
  idKey: keyof T = 'id' as keyof T,
): Record<string | number, T> {
  const next = { ...currentMap };
  for (const row of rows) {
    const key = row[idKey] as string | number;
    if ((row as { deleted?: boolean }).deleted) {
      delete next[key];
    } else {
      next[key] = row;
    }
  }
  return next;
}

/**
 * Fetch a cursor-paginated page from `url`.
 * Extra params (limit, cursor) are appended to the URL.
 */
export async function fetchPage<T extends object>(
  url: string,
  token: string,
  params: Record<string, string> = {},
): Promise<{ rows: T[]; nextCursor: string | null }> {
  const reqUrl = new URL(url);
  for (const [k, v] of Object.entries(params)) reqUrl.searchParams.set(k, v);
  const res = await fetch(reqUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const body = (await res.json()) as { items?: T[]; nextCursor?: string | null };
  return { rows: body.items ?? [], nextCursor: body.nextCursor ?? null };
}

/**
 * Fetch a delta from `url` for rows newer than `since`.
 * Returns { rows, newSince } on 200, or null on 304 / empty.
 */
export async function fetchDelta<T extends object>(
  url: string,
  since: Date,
  token: string,
): Promise<{ rows: T[]; newSince: Date } | null> {
  const reqUrl = new URL(url);
  reqUrl.searchParams.set('since', since.toISOString());
  const res = await fetch(reqUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 304 || res.status === 204) return null;
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);

  const body = (await res.json()) as Record<string, T[] | undefined>;
  // pick whichever key your endpoint returns
  const rows: T[] =
    body.spaces ?? body.members ?? body.items ?? body.folders ?? body.friends ?? [];
  if (rows.length === 0) return null;

  // high-water mark from server timestamps — never Date.now()
  const newSince = rows.reduce((max, r) => {
    const row = r as { updated_at?: string; created_at?: string };
    const t = new Date((row.updated_at ?? row.created_at) as string);
    return t > max ? t : max;
  }, since);

  return { rows, newSince };
}
