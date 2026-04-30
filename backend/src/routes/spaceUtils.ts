import path from 'path';
import { TRASH } from '../config';

export const canWrite = (role: string): boolean =>
  ['contributor', 'moderator', 'admin'].includes(role);

export const canManageTrash = (role: string): boolean =>
  ['moderator', 'admin'].includes(role);

export const uniqueDisplayName = (original: string, taken: Set<string>): string => {
  if (!taken.has(original)) return original;
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  let n = 1;
  while (taken.has(`${base}(${n})${ext}`)) n++;
  return `${base}(${n})${ext}`;
};

export const toItemResponse = (
  _spaceId: number,
  item: {
    photo_id: string;
    display_name: string;
    uploaded_at: Date;
    mime_type: string;
    size_bytes: number;
    folder_id: number | null;
    trashed_at?: Date | null;
  },
) => {
  const trashedAt = item.trashed_at ?? null;
  const expiresAt = trashedAt
    ? new Date(trashedAt.getTime() + TRASH.EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    : null;
  return {
    itemId: item.photo_id,
    displayName: item.display_name,
    uploadedAt: item.uploaded_at,
    mimeType: item.mime_type,
    sizeBytes: item.size_bytes,
    folderId: item.folder_id,
    trashedAt,
    expiresAt,
  };
};
