import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { access, constants, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../config/env.js';

/**
 * Where uploaded bytes live. Only the disk version exists; an S3 version would implement the
 * same methods (`pathFor` would become a ranged read stream, since `res.sendFile` needs a path).
 */
export interface Storage {
  /** A fresh temporary path to stream an upload into. */
  tempPath(): string;
  /** Moves a finished temporary file to its permanent key (atomic on one disk). */
  commit(tempPath: string, key: string): Promise<void>;
  /** The local path of a stored object, for streaming with Range support. */
  pathFor(key: string): string;
  /** Removes a stored object or a temporary file; missing files are ignored. */
  remove(key: string): Promise<void>;
  removeTemp(tempPath: string): Promise<void>;
  /** Deletes temporary files older than `ms`; returns how many. */
  sweepTemp(ms: number): Promise<number>;
  isWritable(): Promise<boolean>;
}

const KEY = /^[0-9a-f-]{36}$/;

export function diskStorage(root: string): Storage {
  const tmp = join(root, 'tmp');
  const objects = join(root, 'objects');
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  mkdirSync(objects, { recursive: true, mode: 0o700 });

  // Keys are generated here (UUIDs), never taken from a request; the check is defence in depth.
  const objectPath = (key: string) => {
    if (!KEY.test(key)) throw new Error('invalid storage key');
    return join(objects, key);
  };

  return {
    tempPath: () => join(tmp, `${randomUUID()}.part`),
    commit: (tempPath, key) => rename(tempPath, objectPath(key)),
    pathFor: objectPath,
    remove: (key) => rm(objectPath(key), { force: true }),
    removeTemp: (tempPath) => rm(tempPath, { force: true }),
    async sweepTemp(ms) {
      let removed = 0;
      for (const name of await readdir(tmp)) {
        const path = join(tmp, name);
        const info = await stat(path).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > ms) {
          await rm(path, { force: true });
          removed++;
        }
      }
      return removed;
    },
    isWritable: () =>
      access(root, constants.W_OK).then(
        () => true,
        () => false,
      ),
  };
}

export const storage: Storage = diskStorage(env.STORAGE_DIR);
