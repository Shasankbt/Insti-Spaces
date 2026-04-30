import fs from 'fs/promises';
import path from 'path';
import type { StorageAdapter } from './StorageAdapter';

export class LocalStorageAdapter implements StorageAdapter {
  readonly root: string;

  constructor(rootPath: string) {
    this.root = path.resolve(rootPath);
  }

  resolveAbsolute(relativePath: string): string {
    const abs = path.resolve(this.root, relativePath);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return abs;
  }

  async save(absoluteSrcPath: string, relativeDestPath: string): Promise<void> {
    const dest = this.resolveAbsolute(relativeDestPath);
    try {
      await fs.rename(absoluteSrcPath, dest);
    } catch {
      // Cross-device rename fallback.
      await fs.copyFile(absoluteSrcPath, dest);
      await fs.unlink(absoluteSrcPath);
    }
  }

  async copyFile(relativeSrc: string, relativeDest: string): Promise<void> {
    const src = this.resolveAbsolute(relativeSrc);
    const dest = this.resolveAbsolute(relativeDest);
    await fs.copyFile(src, dest);
  }

  async deleteFile(relativePath: string): Promise<void> {
    const abs = this.resolveAbsolute(relativePath);
    try {
      await fs.unlink(abs);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
  }

  async ensureDir(relativePath: string): Promise<void> {
    const abs = this.resolveAbsolute(relativePath);
    await fs.mkdir(abs, { recursive: true });
  }
}
