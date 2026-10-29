import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileRecord, hub } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { sweepFiles } from '../../src/platform/files/index.js';
import { containsPattern, prefixQuery } from '../../src/modules/hub/resources.js';
import { account, expectError, setupHub, user, type Hub, type Session } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

const pdf = (size = 20_000) => Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(size)]);
async function upload(s: Session, body = pdf(), name = 'notes.pdf') {
  const res = await s.http.post('/api/files/hub.resource').attach('file', body, name);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return FileRecord.parse(res.body);
}
const search = async (s: Session, qs: string) =>
  hub.pages.resources.parse((await s.http.get(`/api/hub/resources?${qs}`).expect(200)).body);
const titles = async (s: Session, qs: string) => (await search(s, qs)).items.map((r) => r.title);

describe('search helpers', () => {
  it('builds a prefix tsquery from letters and digits only', () => {
    expect(prefixQuery('Graph algo')).toBe('graph:* & algo:*');
    expect(prefixQuery("'; DROP TABLE users; --")).toBe('drop:* & table:* & users:*');
    expect(prefixQuery('% _ !&|')).toBe('');
    expect(containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('resource repository', () => {
  it('lists the seed newest first with uploader, size, type and date', async () => {
    const aarav = await account(h, 'student@universe.test');
    const page = await search(aarav, '');
    expect(page.items.map((r) => [r.title, r.subject, r.uploader.name, r.type])).toEqual([
      ['OS Unit 3 · Process scheduling notes', 'OS', 'Prof. Kavita Nair', 'notes'],
      ['DBMS normalisation worked examples', 'DBMS', 'Diya Kulkarni', 'study_material'],
      ['CN subnetting cheat sheet', 'CN', 'Kabir Shah', 'cheat_sheet'],
      ['Graph algorithms, 40 problems', 'DSA', 'Prof. Neha Iyer', 'study_material'],
      ['OS previous year papers 2022–2025', 'OS', 'Admin Office', 'question_paper'],
      ['Deadlock detection diagrams', 'OS', 'Ishita Rao', 'notes'],
    ]);
    expect(page.items.map((r) => [r.sizeBytes, r.mimeType])).toEqual([
      [2_516_582, 'application/pdf'],
      [1_153_434, 'application/pdf'],
      [655_360, 'image/png'],
      [3_984_589, 'application/pdf'],
      [6_501_171, 'application/pdf'],
      [901_120, 'image/jpeg'],
    ]);
    expect(page.items.every((r) => !r.canDelete)).toBe(true);
    // Filters and paging.
    expect(await titles(aarav, 'subject=OS&type=notes')).toEqual([
      'OS Unit 3 · Process scheduling notes',
      'Deadlock detection diagrams',
    ]);
    const first = await search(aarav, 'limit=4');
    const second = await search(aarav, `limit=4&cursor=${first.nextCursor}`);
    expect([...first.items, ...second.items].map((r) => r.id)).toEqual(page.items.map((r) => r.id));
    expect(second.nextCursor).toBeNull();
  });

  it('upload → attach → search by title word, subject and uploader → download by another student → delete', async () => {
    const author = await user(h, 'student', 'Meera Upadhyay');
    const file = await upload(author);
    const created = hub.Resource.parse(
      (
        await author.http
          .post('/api/hub/resources')
          .send({
            fileId: file.id,
            title: 'Paging and segmentation summary',
            subject: 'OS',
            type: 'notes',
            semester: 5,
          })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({
      uploader: { name: 'Meera Upadhyay' },
      sizeBytes: file.sizeBytes,
      canDelete: true,
    });

    const reader = await user(h);
    expect(await titles(reader, 'q=segmentat')).toEqual(['Paging and segmentation summary']); // word prefix
    expect(await titles(reader, 'q=page')).toContain('Paging and segmentation summary'); // stem of "paging"
    expect(await titles(reader, 'q=paging%20summ')).toEqual(['Paging and segmentation summary']); // every word
    expect((await titles(reader, 'q=os')).length).toBe(4); // subject: 3 seeded OS + this one
    expect(await titles(reader, 'q=upadhy')).toEqual(['Paging and segmentation summary']); // uploader name
    expect(await titles(reader, 'q=kavita')).toEqual(['OS Unit 3 · Process scheduling notes']);
    // Relevance first: a title match beats a description-only match.
    const ranked = await search(reader, 'q=deadlock');
    expect(ranked.items[0]?.title).toBe('Deadlock detection diagrams');

    await reader.http.get(`/api/files/${file.id}`).expect(200);
    const driver = await account(h, 'ramesh.patil@drivers.universe.test');
    const invigilator = await account(h, 'invigilator@universe.test');
    await driver.http.get(`/api/files/${file.id}`).expect(404);
    await invigilator.http.get(`/api/files/${file.id}`).expect(404);

    // Attached files can't be deleted from under the resource, and the sweep keeps them.
    expectError(await author.http.delete(`/api/files/${file.id}`), 409, 'FILE_IN_USE');
    await prisma.file.update({
      where: { id: file.id },
      data: { deletedAt: new Date(Date.now() - 48 * 3_600_000) },
    });
    await sweepFiles(h.modules);
    expect(await prisma.file.findUnique({ where: { id: file.id } })).not.toBeNull();
    await prisma.file.update({ where: { id: file.id }, data: { deletedAt: null } });

    expectError(await reader.http.delete(`/api/hub/resources/${created.id}`), 403);
    await author.http.delete(`/api/hub/resources/${created.id}`).expect(204);
    expect(await titles(reader, 'q=segmentation')).toEqual([]);
    // Once the resource is gone the file is the uploader's own again.
    await reader.http.get(`/api/files/${file.id}`).expect(404);
    await author.http.get(`/api/files/${file.id}`).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'hub.resource_deleted' } })).toBe(0);
  });

  it("refuses someone else's file, a second attach, unknown subjects and renamed executables", async () => {
    const a = await user(h);
    const b = await user(h);
    const file = await upload(a);
    const body = { fileId: file.id, title: 'My notes', subject: 'DBMS', type: 'notes' };
    expectError(await b.http.post('/api/hub/resources').send(body), 404);
    // An unattached file stays owner-only.
    await b.http.get(`/api/files/${file.id}`).expect(404);
    await a.http.post('/api/hub/resources').send(body).expect(201);
    expectError(await a.http.post('/api/hub/resources').send(body), 409, 'FILE_ALREADY_ATTACHED');
    const other = await upload(a);
    expectError(
      await a.http.post('/api/hub/resources').send({ ...body, fileId: other.id, subject: 'ZZZ' }),
      400,
    );
    expectError(
      await a.http.post('/api/hub/resources').send({ ...body, fileId: other.id, title: 'ab' }),
      400,
    );
    expectError(
      await a.http
        .post('/api/hub/resources')
        .send({ ...body, fileId: other.id, uploaderId: b.user.id }),
      400,
    );
    // An executable renamed to .pdf: the platform checks the bytes.
    const elf = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
      randomBytes(4000),
    ]);
    expectError(
      await a.http.post('/api/files/hub.resource').attach('file', elf, 'notes.pdf'),
      415,
      'UNSUPPORTED_FILE_TYPE',
    );
  });

  it('treats SQL wildcards and injection attempts as plain text', async () => {
    const s = await user(h);
    // Only wildcards or punctuation: nothing matches (no "match everything").
    for (const q of ['%', '_', '%%', "'", '\\', ':*', '!', '&|', '%_%']) {
      const res = await search(s, `q=${encodeURIComponent(q)}`);
      expect(res.items, q).toEqual([]);
    }
    // Injection attempts are just their words: the same results as typing the words.
    const same = async (attack: string, words: string) =>
      expect(await titles(s, `q=${encodeURIComponent(attack)}`)).toEqual(
        await titles(s, `q=${encodeURIComponent(words)}`),
      );
    await same("' OR 1=1 --", 'or 1 1');
    await same("'; DROP TABLE hub_resources; --", 'drop table hub resources');
    await same('os%', 'os');
    expect(await titles(s, `q=${encodeURIComponent("' OR ''='")}`)).toEqual([]);
    expect(await prisma.hubResource.count()).toBeGreaterThanOrEqual(6);
    expectError(await s.http.get('/api/hub/resources?q=os&cursor=bm9wZQ'), 400);
    expectError(await s.http.get('/api/hub/resources?unknown=1'), 400);
  });

  it('lets an admin see deleted resources and delete any (audited)', async () => {
    const admin = await account(h, 'admin@universe.test');
    const target = (await search(admin, 'q=subnetting')).items[0];
    expect(target?.canDelete).toBe(true);
    await admin.http.delete(`/api/hub/resources/${target?.id}`).expect(204);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'hub.resource_deleted' },
    });
    expect(entry).toMatchObject({
      targetId: target?.id,
      metadata: { subject: 'CN', type: 'cheat_sheet', ownResource: false },
    });
    const deleted = hub.pages.resources.parse(
      (await admin.http.get('/api/hub/admin/resources?status=deleted').expect(200)).body,
    );
    expect(deleted.items.map((r) => r.id)).toContain(target?.id);
    expect(deleted.items.every((r) => r.deletedAt !== null)).toBe(true);
    const student = await user(h);
    await student.http.get('/api/hub/admin/resources').expect(403);
    expect(await titles(student, 'q=subnetting')).toEqual([]);
  });

  it('rate-limits search to 60 per minute per user', async () => {
    const s = await user(h);
    for (let i = 0; i < 60; i += 1) await s.http.get('/api/hub/resources?limit=1').expect(200);
    expectError(await s.http.get('/api/hub/resources?limit=1'), 429, 'TOO_MANY_SEARCHES');
    await (await user(h)).http.get('/api/hub/resources?limit=1').expect(200);
  });

  it('lists subjects', async () => {
    const s = await user(h);
    const subjects = (await s.http.get('/api/hub/subjects').expect(200)).body as { code: string }[];
    expect(subjects.map((x) => x.code)).toEqual([
      'OS',
      'DBMS',
      'CN',
      'DSA',
      'OOP',
      'MATHS',
      'OTHER',
    ]);
  });
});
