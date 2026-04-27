import path from 'path';

export const toMediaUrl = (spaceId: number, storagePath: string): string => {
  const kind = path.basename(path.dirname(storagePath));
  const filename = path.basename(storagePath);
  return `/spaces/${spaceId}/media/${kind}/${encodeURIComponent(filename)}`;
};
