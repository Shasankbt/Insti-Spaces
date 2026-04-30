export interface StorageAdapter {
  /** Resolved absolute root of the storage tree. */
  root: string;
  /**
   * Resolve a storage-relative path to an absolute filesystem path.
   * Throws if the resolved path escapes the root (path-traversal guard).
   */
  resolveAbsolute(relativePath: string): string;
  /** Move an already-absolute source file into storage at relativeDestPath. */
  save(absoluteSrcPath: string, relativeDestPath: string): Promise<void>;
  /** Copy a file between two storage-relative paths. */
  copyFile(relativeSrc: string, relativeDest: string): Promise<void>;
  /** Delete a storage-relative file, silently ignoring ENOENT. */
  deleteFile(relativePath: string): Promise<void>;
  /** Ensure a storage-relative directory exists (mkdir -p). */
  ensureDir(relativePath: string): Promise<void>;
}
