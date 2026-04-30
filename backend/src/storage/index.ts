import { LocalStorageAdapter } from './LocalStorageAdapter';

export type { StorageAdapter } from './StorageAdapter';

export const storage = new LocalStorageAdapter(process.env.UPLOADS_ROOT ?? './uploads');
