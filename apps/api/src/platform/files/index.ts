import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { fileTypeFromFile } from 'file-type';
import { z } from 'zod';
import type { FileRecord } from '@universe/contracts';
import { env } from '../../config/env.js';
import type { File } from '../../generated/prisma/client.js';
import { authOf, requireAuth } from '../auth/guards.js';
import { prisma, type Db } from '../db.js';
import { ApiError, asyncHandler, IdParam } from '../http.js';
import { logger } from '../logger.js';
import type { FilePurpose, ModuleDefinition } from '../modules/index.js';
import { storage } from './storage.js';

const QUOTA_BYTES = env.STORAGE_QUOTA_MB * 1024 * 1024;
const TEMP_MAX_AGE_MS = 3_600_000;
const DELETED_KEEP_MS = 24 * 3_600_000;
const PurposeParam = z
  .object({
    purpose: z
      .string()
      .regex(/^[a-z]+\.[a-z0-9_-]+$/)
      .max(64),
  })
  .strict();

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');
const quotaExceeded = () =>
  new ApiError(413, 'QUOTA_EXCEEDED', `Your storage quota of ${env.STORAGE_QUOTA_MB} MB is full`);

/**
 * A safe display name: last path segment only, NFC, no control or bidi-override characters, no
 * quotes or characters reserved on common file systems, no leading dots, at most 200 characters.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069"'`<>:*?|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return Array.from(clean).slice(0, 200).join('') || 'file';
}

/** `attachment` with an ASCII fallback and the exact UTF-8 name per RFC 6266 / RFC 5987. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const toFileRecord = (f: File): FileRecord => ({
  id: f.id,
  ownerId: f.ownerId,
  module: f.module,
  purpose: f.purpose,
  originalName: f.originalName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  sha256: f.sha256,
  createdAt: f.createdAt.toISOString(),
});

const usedBytes = async (db: Db, ownerId: string) =>
  (await db.file.aggregate({ where: { ownerId, deletedAt: null }, _sum: { sizeBytes: true } }))._sum
    .sizeBytes ?? 0;

interface Received {
  tempPath: string;
  size: number;
  sha256: string;
  filename: string;
}

/**
 * Streams exactly one multipart file to a temporary file, hashing as it goes. Limits are
 * enforced while streaming; on any failure (limit, bad form, client disconnect) the temporary
 * file is deleted before the promise rejects.
 */
function receiveUpload(req: Request, maxBytes: number): Promise<Received> {
  return new Promise((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({
        headers: req.headers,
        // Browsers send UTF-8 filenames; busboy's default is latin1.
        defParamCharset: 'utf8',
        limits: { files: 1, fields: 0, parts: 1, fileSize: maxBytes, headerPairs: 20 },
      });
    } catch {
      reject(new ApiError(400, 'INVALID_UPLOAD', 'Send one file as multipart/form-data'));
      return;
    }
    const tempPath = storage.tempPath();
    let file: Readable | undefined;
    let out: WriteStream | undefined;
    let written: Promise<Omit<Received, 'tempPath'>> | undefined;
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      req.unpipe(bb);
      // Delete only after the write stream has closed, or a late open could re-create the file.
      const closed =
        out && !out.closed
          ? new Promise<void>((done) => out?.once('close', () => done()))
          : Promise.resolve();
      file?.destroy();
      out?.destroy();
      void closed
        .then(() => storage.removeTemp(tempPath))
        .catch((e: unknown) => logger.error({ err: e }, 'could not delete a temporary upload'))
        .finally(() => reject(err instanceof Error ? err : new Error(String(err))));
    };

    // Limits: one file part, no fields. busboy skips any further parts without reading them
    // into memory or onto disk, and truncates the file at `fileSize` (the 'limit' event).
    bb.on('file', (_field, stream, info) => {
      file = stream;
      out = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
      const hash = createHash('sha256');
      let size = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      });
      stream.on('limit', () =>
        fail(new ApiError(413, 'FILE_TOO_LARGE', `The file is larger than ${maxBytes} bytes`)),
      );
      written = pipeline(stream, tap, out).then(() => ({
        size,
        sha256: hash.digest('hex'),
        filename: info.filename ?? '',
      }));
      written.catch(fail);
    });
    bb.on('error', () => fail(new ApiError(400, 'INVALID_UPLOAD', 'The upload could not be read')));
    bb.on('close', () => {
      if (!written) return fail(new ApiError(400, 'INVALID_UPLOAD', 'No file was sent'));
      written.then((r) => {
        if (settled) return;
        settled = true;
        resolve({ ...r, tempPath });
      }, fail);
    });
    req.on('close', () => {
      if (!req.complete) fail(new ApiError(400, 'UPLOAD_ABORTED', 'The upload was interrupted'));
    });
    req.pipe(bb);
  });
}

export interface SaveFileInput {
  ownerId: string;
  module: string;
  purpose: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}

/**
 * Stores bytes the server already holds (seeds, generated files) the same way an upload is
 * stored. The caller vouches for `mimeType`; uploads from users go through `POST /api/files`.
 */
export async function saveFile(input: SaveFileInput): Promise<FileRecord> {
  const tempPath = storage.tempPath();
  const key = randomUUID();
  await writeFile(tempPath, input.bytes, { flag: 'wx', mode: 0o600 });
  try {
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.file.create({
        data: {
          ownerId: input.ownerId,
          module: input.module,
          purpose: input.purpose,
          originalName: sanitizeFilename(input.originalName),
          mimeType: input.mimeType,
          sizeBytes: input.bytes.length,
          sha256: createHash('sha256').update(input.bytes).digest('hex'),
          storageKey: key,
        },
      });
      await storage.commit(tempPath, key);
      return created;
    });
    return toFileRecord(record);
  } catch (err) {
    await storage.removeTemp(tempPath);
    throw err;
  }
}

/** The ids among `files` that their purpose's module still references. */
async function referenced(
  modules: readonly ModuleDefinition[],
  files: readonly { id: string; purpose: string }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const module of modules) {
    for (const purpose of module.filePurposes ?? []) {
      const ids = files.filter((f) => f.purpose === purpose.id).map((f) => f.id);
      if (ids.length === 0 || !purpose.inUse) continue;
      for (const id of await purpose.inUse(ids)) out.add(id);
    }
  }
  return out;
}

/** `/api/files`: uploads, downloads and deletes for every purpose the modules register. */
export function fileRoutes(modules: readonly ModuleDefinition[]): Router {
  const purposes = new Map<string, { purpose: FilePurpose; module: ModuleDefinition }>();
  for (const module of modules)
    for (const purpose of module.filePurposes ?? []) purposes.set(purpose.id, { purpose, module });

  const canRead = async (user: ReturnType<typeof authOf>['user'], file: File) => {
    const entry = purposes.get(file.purpose);
    return !!entry && (await entry.purpose.authorizeRead(user, file));
  };

  // ponytail: in-memory store, per process; a multi-instance deployment needs a shared store (Redis).
  const uploadLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).user.id,
    handler: (_req, _res, next) =>
      next(new ApiError(429, 'TOO_MANY_UPLOADS', 'Too many uploads. Try again in a minute.')),
  });

  const router = Router();
  router.use(requireAuth);

  router.post(
    '/:purpose',
    uploadLimiter,
    asyncHandler(async (req, res) => {
      // An error may be sent while the client is still uploading: close the connection
      // afterwards instead of reading the rest of an unwanted body.
      res.on('finish', () => {
        if (!req.complete) req.socket.destroy();
      });
      const { user } = authOf(req);
      const entry = purposes.get(PurposeParam.parse(req.params).purpose);
      if (!entry || !entry.module.roles.includes(user.role)) throw notFound();
      if (!req.is('multipart/form-data'))
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data');
      // Fail fast before reading any bytes; checked again under a lock before saving.
      if ((await usedBytes(prisma, user.id)) >= QUOTA_BYTES) throw quotaExceeded();

      const upload = await receiveUpload(req, entry.purpose.maxBytes);
      const key = randomUUID();
      let committed = false;
      try {
        const type = await fileTypeFromFile(upload.tempPath);
        if (!type || !entry.purpose.mimeTypes.includes(type.mime))
          throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'This type of file is not allowed here');
        const record = await prisma.$transaction(async (tx) => {
          // One upload per user at a time past this point, so two uploads cannot both fit the quota.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
          if ((await usedBytes(tx, user.id)) + upload.size > QUOTA_BYTES) throw quotaExceeded();
          const created = await tx.file.create({
            data: {
              ownerId: user.id,
              module: entry.module.id,
              purpose: entry.purpose.id,
              originalName: sanitizeFilename(upload.filename),
              mimeType: type.mime,
              sizeBytes: upload.size,
              sha256: upload.sha256,
              storageKey: key,
            },
          });
          await storage.commit(upload.tempPath, key);
          committed = true;
          return created;
        });
        res.status(201).json(toFileRecord(record));
      } catch (err) {
        await storage.removeTemp(upload.tempPath);
        if (committed) await storage.remove(key); // the rename happened but the commit failed
        throw err;
      }
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res, next) => {
      const { user } = authOf(req);
      const { id } = IdParam.parse(req.params);
      const file = await prisma.file.findFirst({ where: { id, deletedAt: null } });
      if (!file || !(await canRead(user, file))) throw notFound();

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', contentDisposition(file.originalName));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache');
      // `send` handles Range (206/416), HEAD and conditional requests.
      res.sendFile(
        storage.pathFor(file.storageKey),
        { cacheControl: false, dotfiles: 'deny' },
        (err: (Error & { status?: number }) | undefined) => {
          if (!err) return;
          if (res.headersSent) return next(err);
          // `send` has already set `Content-Range: bytes */<size>` for an unsatisfiable range.
          next(
            err.status === 416
              ? new ApiError(416, 'RANGE_NOT_SATISFIABLE', 'Requested range not satisfiable')
              : notFound(),
          );
        },
      );
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const { user } = authOf(req);
      const { id } = IdParam.parse(req.params);
      const file = await prisma.file.findFirst({ where: { id, deletedAt: null } });
      if (!file || !(await canRead(user, file))) throw notFound();
      if (file.ownerId !== user.id && user.role !== 'admin')
        throw new ApiError(403, 'FORBIDDEN', 'Only the owner or an admin can delete this file');
      if ((await referenced(modules, [file])).has(id))
        throw new ApiError(409, 'FILE_IN_USE', 'This file is still attached to a record');
      // Soft delete: hidden at once; the bytes are removed by the sweep after 24 hours.
      await prisma.file.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      res.status(204).end();
    }),
  );

  return router;
}

/**
 * Removes stale temporary files and the bytes (then rows) of files deleted over 24 hours ago,
 * except files a module still references (a delete that raced an attach stays readable).
 */
export async function sweepFiles(
  modules: readonly ModuleDefinition[] = [],
): Promise<{ temp: number; purged: number }> {
  const temp = await storage.sweepTemp(TEMP_MAX_AGE_MS);
  const candidates = await prisma.file.findMany({
    where: { deletedAt: { lt: new Date(Date.now() - DELETED_KEEP_MS) } },
    select: { id: true, storageKey: true, purpose: true },
    take: 1_000,
  });
  const keep = await referenced(modules, candidates);
  const expired = candidates.filter((f) => !keep.has(f.id));
  for (const f of expired) await storage.remove(f.storageKey);
  const { count } = await prisma.file.deleteMany({
    where: { id: { in: expired.map((f) => f.id) } },
  });
  return { temp, purged: count };
}

/** Runs the sweep now and hourly. The timer never keeps the process alive. */
export function startFileSweep(modules: readonly ModuleDefinition[]): () => void {
  const run = () => {
    sweepFiles(modules).then(
      (counts) => logger.info(counts, 'file sweep finished'),
      (err: unknown) => logger.error({ err }, 'file sweep failed'),
    );
  };
  run();
  const timer = setInterval(run, 3_600_000).unref();
  return () => clearInterval(timer);
}
