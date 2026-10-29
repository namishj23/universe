import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorBody, FileRecord } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { prisma } from '../src/platform/db.js';
import { contentDisposition, sanitizeFilename, sweepFiles } from '../src/platform/files/index.js';
import { storage } from '../src/platform/files/storage.js';
import { loadModules, type ModuleDefinition } from '../src/platform/modules/index.js';
import { as, login, seed } from './helpers.js';

const STORAGE_DIR = process.env.STORAGE_DIR ?? '';
const tmpFiles = () => readdirSync(join(STORAGE_DIR, 'tmp'));
const objects = () => readdirSync(join(STORAGE_DIR, 'objects'));
const codeOf = (body: unknown) => ApiErrorBody.parse(body).error.code;
const pdf = (size = 50_000) => Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(size)]);

let modules: ModuleDefinition[];
let app: ReturnType<typeof createApp>;
let student: Awaited<ReturnType<typeof login>>;
beforeAll(async () => {
  await seed();
  modules = await loadModules();
  app = createApp({ modules });
});
// Sign in on a fresh app each time (the login rate limit is per app), then use the shared one.
const signIn = async (email: string) => ({ ...(await login(email)), app });
beforeEach(async () => {
  student = await signIn('student@universe.test');
});

const upload = (session: typeof student, body: Buffer, filename = 'notes.pdf') =>
  as(session).post('/api/files/hub.resource').attach('file', body, filename);

describe('upload and download', () => {
  it('stores an allowed PDF and returns it byte for byte with safe headers', async () => {
    const body = pdf();
    const res = await upload(student, body).expect(201);
    const file = FileRecord.parse(res.body);
    expect(file).toMatchObject({
      ownerId: student.user.id,
      module: 'hub',
      purpose: 'hub.resource',
      originalName: 'notes.pdf',
      mimeType: 'application/pdf',
      sizeBytes: body.length,
    });

    const down = await as(student)
      .get(`/api/files/${file.id}`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(down.body as Buffer, body)).toBe(0);
    expect(down.headers['content-type']).toBe('application/pdf');
    expect(down.headers['x-content-type-options']).toBe('nosniff');
    expect(down.headers['cache-control']).toBe('private, no-cache');
    expect(down.headers['accept-ranges']).toBe('bytes');
    expect(down.headers['content-disposition']).toBe(
      `attachment; filename="notes.pdf"; filename*=UTF-8''notes.pdf`,
    );
    expect(tmpFiles()).toEqual([]);
  });

  it('answers a Range request with 206 and exactly those bytes', async () => {
    const body = pdf(10_000);
    const { id } = FileRecord.parse((await upload(student, body).expect(201)).body);
    const res = await as(student)
      .get(`/api/files/${id}`)
      .set('Range', 'bytes=100-199')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(206);
    expect(res.headers['content-range']).toBe(`bytes 100-199/${body.length}`);
    expect(Buffer.compare(res.body as Buffer, body.subarray(100, 200))).toBe(0);
    await as(student)
      .get(`/api/files/${id}`)
      .set('Range', `bytes=${body.length + 10}-`)
      .expect(416);
  });

  it('gives another user 404, not 403; admins may read', async () => {
    const { id } = FileRecord.parse((await upload(student, pdf(100)).expect(201)).body);
    for (const email of ['student2@universe.test', 'invigilator@universe.test']) {
      const other = await signIn(email);
      expect(codeOf((await as(other).get(`/api/files/${id}`).expect(404)).body)).toBe('NOT_FOUND');
      await as(other).delete(`/api/files/${id}`).expect(404);
    }
    await as(await signIn('admin@universe.test'))
      .get(`/api/files/${id}`)
      .expect(200);
    await as(student).get(`/api/files/${randomUUID()}`).expect(404);
    await as(student).get('/api/files/not-a-uuid').expect(400);
  });
});

describe('rejections', () => {
  it('rejects an executable renamed to .pdf', async () => {
    const before = objects().length;
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(58), randomBytes(2_000)]);
    const res = await upload(student, exe, 'invoice.pdf').expect(415);
    expect(codeOf(res.body)).toBe('UNSUPPORTED_FILE_TYPE');
    expect(objects()).toHaveLength(before);
    expect(tmpFiles()).toEqual([]);
  });

  it('rejects an oversized file while streaming and leaves nothing on disk', async () => {
    const before = objects().length;
    const rows = await prisma.file.count();
    const res = await upload(student, pdf(10 * 1024 * 1024)).expect(413);
    expect(codeOf(res.body)).toBe('FILE_TOO_LARGE');
    expect(objects()).toHaveLength(before);
    expect(tmpFiles()).toEqual([]);
    expect(await prisma.file.count()).toBe(rows);
  });

  it('rejects an unknown purpose, a role outside the module, no file, and non-multipart bodies', async () => {
    await as(student).post('/api/files/hub.nope').attach('file', pdf(10), 'a.pdf').expect(404);
    const invigilator = await signIn('invigilator@universe.test');
    await upload(invigilator, pdf(10)).expect(404);
    await as(student).post('/api/files/hub.resource').field('note', 'x').expect(400);
    await as(student).post('/api/files/hub.resource').send({ file: 'x' }).expect(415);
    await request(app)
      .post('/api/files/hub.resource')
      .set('Cookie', student.cookie)
      .attach('file', pdf(10), 'a.pdf')
      .expect(403); // no CSRF token
    expect(tmpFiles()).toEqual([]);
  });

  it('enforces the per-user quota', async () => {
    const quota = 200 * 1024 * 1024;
    const user = await signIn('student2@universe.test');
    const fake = { ownerId: user.user.id, module: 'hub', purpose: 'hub.resource' } as const;
    const row = await prisma.file.create({
      data: {
        ...fake,
        originalName: 'big.pdf',
        mimeType: 'application/pdf',
        sizeBytes: quota - 1_000,
        sha256: '0'.repeat(64),
        storageKey: randomUUID(),
      },
    });
    // Fits only if the new file is under 1,000 bytes.
    expect(codeOf((await upload(user, pdf(2_000)).expect(413)).body)).toBe('QUOTA_EXCEEDED');
    await upload(user, pdf(991)).expect(201); // 1,000 bytes: exactly at the quota
    // Now full: refused before any byte is read.
    expect(codeOf((await upload(user, pdf(10)).expect(413)).body)).toBe('QUOTA_EXCEEDED');
    expect(tmpFiles()).toEqual([]);
    await prisma.file.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  });
});

describe('client abort', () => {
  let server: Server | undefined;
  afterAll(() => {
    server?.closeAllConnections();
    server?.close();
  });

  it('deletes the temporary file when the client disconnects mid-upload', async () => {
    const listening = app.listen(0);
    server = listening;
    await new Promise((resolve) => listening.once('listening', resolve));
    const { port } = listening.address() as AddressInfo;
    const boundary = 'x-universe-boundary';
    const req = httpRequest({
      port,
      method: 'POST',
      path: '/api/files/hub.resource',
      headers: {
        cookie: student.cookie,
        'x-csrf-token': student.csrfToken,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(5 * 1024 * 1024),
      },
    });
    req.on('error', () => {});
    req.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    );
    req.write(pdf(256 * 1024));
    await vi.waitFor(() => expect(tmpFiles()).toHaveLength(1));
    req.destroy();
    await vi.waitFor(() => expect(tmpFiles()).toEqual([]));
  });
});

describe('delete and sweep', () => {
  it('soft-deletes for the owner, then the sweep removes the bytes after 24 hours', async () => {
    const { id } = FileRecord.parse((await upload(student, pdf(100)).expect(201)).body);
    const { storageKey } = await prisma.file.findUniqueOrThrow({ where: { id } });
    await as(student).delete(`/api/files/${id}`).expect(204);
    await as(student).get(`/api/files/${id}`).expect(404);
    expect(existsSync(storage.pathFor(storageKey))).toBe(true);

    await sweepFiles();
    expect(existsSync(storage.pathFor(storageKey))).toBe(true); // within the 24-hour window

    await prisma.file.update({
      where: { id },
      data: { deletedAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    await sweepFiles();
    expect(existsSync(storage.pathFor(storageKey))).toBe(false);
    expect(await prisma.file.count({ where: { id } })).toBe(0);
  });

  it('lets an admin delete; removes temporary files older than an hour', async () => {
    const { id } = FileRecord.parse((await upload(student, pdf(100)).expect(201)).body);
    await as(await signIn('admin@universe.test'))
      .delete(`/api/files/${id}`)
      .expect(204);

    const stale = join(STORAGE_DIR, 'tmp', 'stale.part');
    const fresh = join(STORAGE_DIR, 'tmp', 'fresh.part');
    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'x');
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(stale, twoHoursAgo, twoHoursAgo);
    expect((await sweepFiles()).temp).toBe(1);
    expect(tmpFiles()).toEqual(['fresh.part']);
    await storage.removeTemp(fresh);
  });
});

describe('filenames', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\report.pdf', 'report.pdf'],
    ['quote"and\'apostrophe`.pdf', 'quoteandapostrophe.pdf'],
    ['ctrl\u0000\u0007\r\nchars.pdf', 'ctrlchars.pdf'],
    ['bidi\u202Efdp.exe', 'bidifdp.exe'],
    ['...hidden.pdf', 'hidden.pdf'],
    ['<script>:*?|.pdf', 'script.pdf'],
    ['   ', 'file'],
    ['e\u0301te\u0301.pdf', 'été.pdf'],
    [`${'a'.repeat(300)}.pdf`, 'a'.repeat(200)],
  ])('sanitises %j', (raw, expected) => {
    expect(sanitizeFilename(raw)).toBe(expected);
  });

  it('encodes Content-Disposition per RFC 5987 with an ASCII fallback', () => {
    expect(contentDisposition('résumé (final).pdf')).toBe(
      `attachment; filename="r_sum_ (final).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29.pdf`,
    );
  });

  it('stores the sanitised name of an uploaded file', async () => {
    const res = await upload(student, pdf(100), '../../evil\u202E.pdf').expect(201);
    expect(FileRecord.parse(res.body).originalName).toBe('evil.pdf');
  });
});
