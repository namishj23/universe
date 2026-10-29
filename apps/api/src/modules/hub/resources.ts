// Shared academic resource repository: attach an uploaded file, search, soft delete.
import { z } from 'zod';
import { hub } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { ensureProfile, errors, iso, isoOrNull, violates, type User } from './shared.js';

interface Row {
  id: string;
  file_id: string;
  title: string;
  description: string | null;
  subject: string;
  type: string;
  semester: number | null;
  exam_year: number | null;
  uploader_id: string;
  uploader_name: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: Date;
  deleted_at: Date | null;
  rank: number;
}

/**
 * A prefix tsquery built only from letters and digits (`graph:* & algo:*`), so user input can
 * never be tsquery syntax, and SQL wildcards or quotes simply disappear.
 */
export function prefixQuery(q: string): string {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.map((w) => `${w.slice(0, 40)}:*`).join(' & ');
}

/** ILIKE pattern for "contains", with %, _ and \ escaped. */
export const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Search cursor: (rank, created_at, id), base64url JSON. */
const RankCursor = z.tuple([z.number(), z.iso.datetime(), z.uuid()]);
const encodeRank = (r: Row) =>
  Buffer.from(JSON.stringify([r.rank, iso(r.created_at), r.id])).toString('base64url');

export function resourceService(p: Platform) {
  const E = errors(p);

  const decodeRank = (cursor: string) => {
    try {
      return RankCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    } catch {
      throw E.bad('Invalid cursor');
    }
  };

  const toView = (r: Row, user: User): hub.Resource => ({
    id: r.id,
    fileId: r.file_id,
    title: r.title,
    description: r.description,
    subject: r.subject,
    type: r.type as hub.ResourceType,
    semester: r.semester,
    examYear: r.exam_year,
    uploader: { id: r.uploader_id, name: r.uploader_name },
    sizeBytes: r.size_bytes ?? 0,
    mimeType: r.mime_type ?? 'application/octet-stream',
    createdAt: iso(r.created_at),
    deletedAt: isoOrNull(r.deleted_at),
    canDelete: user.role === 'admin' || user.id === r.uploader_id,
  });

  /**
   * One SQL statement either way. With `q`: full-text hits (GIN on `search`) UNION uploader-name
   * hits (trigram GIN on users.name), ranked by ts_rank, then newest. Without: newest first.
   */
  async function search(
    user: User,
    input: z.infer<typeof hub.ResourceQuery> & { status?: 'active' | 'deleted' | 'all' },
  ) {
    const status = input.status ?? 'active';
    const subject = input.subject ?? null;
    const type = input.type ?? null;
    const semester = input.semester ?? null;
    const take = input.limit + 1;
    const q = input.q ?? '';
    let rows: Row[];
    if (q) {
      const tsq = prefixQuery(q);
      const pattern = containsPattern(q);
      const after = input.cursor ? decodeRank(input.cursor) : null;
      rows = await p.prisma.$queryRaw<Row[]>`
        WITH hits AS (
          SELECT r.id, ts_rank(r.search, to_tsquery('simple', ${tsq}))::float8 AS rank
          FROM hub_resources r
          WHERE ${tsq} <> '' AND r.search @@ to_tsquery('simple', ${tsq})
          UNION ALL
          SELECT r.id, 0::float8 FROM users u JOIN hub_resources r ON r.uploader_id = u.id
          WHERE u.name ILIKE ${pattern}
        ), ranked AS (SELECT id, max(rank) AS rank FROM hits GROUP BY id)
        SELECT r.id, r.file_id, r.title, r.description, r.subject, r.type, r.semester::int AS semester,
          r.exam_year::int AS exam_year, r.uploader_id, u.name AS uploader_name,
          f.size_bytes, f.mime_type, r.created_at, r.deleted_at, h.rank
        FROM ranked h
        JOIN hub_resources r ON r.id = h.id
        JOIN users u ON u.id = r.uploader_id
        LEFT JOIN files f ON f.id = r.file_id
        WHERE (${status} = 'all' OR (${status} = 'active') = (r.deleted_at IS NULL))
          AND (${subject}::text IS NULL OR r.subject = ${subject})
          AND (${type}::text IS NULL OR r.type = ${type})
          AND (${semester}::int IS NULL OR r.semester = ${semester}::int)
          AND (${after?.[0] ?? null}::float8 IS NULL
               OR (h.rank, r.created_at, r.id) < (${after?.[0] ?? null}::float8,
                   ${after ? new Date(after[1]) : null}::timestamptz, ${after?.[2] ?? null}::uuid))
        ORDER BY h.rank DESC, r.created_at DESC, r.id DESC
        LIMIT ${take}`;
    } else {
      const after = input.cursor ? p.paging.decodeCursor(input.cursor) : null;
      rows = await p.prisma.$queryRaw<Row[]>`
        SELECT r.id, r.file_id, r.title, r.description, r.subject, r.type, r.semester::int AS semester,
          r.exam_year::int AS exam_year, r.uploader_id, u.name AS uploader_name,
          f.size_bytes, f.mime_type, r.created_at, r.deleted_at, 0::float8 AS rank
        FROM hub_resources r
        JOIN users u ON u.id = r.uploader_id
        LEFT JOIN files f ON f.id = r.file_id
        WHERE (${status} = 'all' OR (${status} = 'active') = (r.deleted_at IS NULL))
          AND (${subject}::text IS NULL OR r.subject = ${subject})
          AND (${type}::text IS NULL OR r.type = ${type})
          AND (${semester}::int IS NULL OR r.semester = ${semester}::int)
          AND (${after?.createdAt ?? null}::timestamptz IS NULL
               OR (r.created_at, r.id) < (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${take}`;
    }
    const page = rows.slice(0, input.limit);
    const last = rows.length > input.limit ? page.at(-1) : undefined;
    return {
      items: page.map((r) => toView(r, user)),
      nextCursor: last
        ? q
          ? encodeRank(last)
          : p.paging.encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
    };
  }

  const list = (user: User, query: unknown) => search(user, hub.ResourceQuery.parse(query));
  const adminList = (user: User, query: unknown) =>
    search(user, hub.AdminResourceQuery.parse(query));

  const subjects = () =>
    p.prisma.hubSubject.findMany({ orderBy: { sort: 'asc' }, select: { code: true, name: true } });

  /** Attaches the caller's own uploaded `hub.resource` file (once) as a resource. */
  async function create(user: User, body: unknown) {
    const input = hub.CreateResourceRequest.parse(body);
    const file = await p.prisma.file.findFirst({
      where: { id: input.fileId, deletedAt: null, ownerId: user.id, purpose: 'hub.resource' },
      select: { id: true },
    });
    // Someone else's file, a deleted one or another purpose: indistinguishable from missing.
    if (!file)
      throw E.notFound('File not found. Upload it with POST /api/files/hub.resource first.');
    if (!(await p.prisma.hubSubject.findUnique({ where: { code: input.subject } })))
      throw E.bad('Unknown subject.');
    let id: string;
    try {
      id = await p.transaction(async (tx) => {
        await ensureProfile(tx, user.id);
        const created = await tx.hubResource.create({
          data: {
            fileId: input.fileId,
            title: input.title,
            description: input.description ?? null,
            subject: input.subject,
            type: input.type,
            semester: input.semester ?? null,
            examYear: input.examYear ?? null,
            uploaderId: user.id,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (err) {
      if (violates(err, 'hub_resources_file_id_key'))
        throw E.conflict('FILE_ALREADY_ATTACHED', 'This file is already attached to a resource.');
      throw err;
    }
    return one(user, id);
  }

  async function one(user: User, id: string) {
    const [row] = await p.prisma.$queryRaw<Row[]>`
      SELECT r.id, r.file_id, r.title, r.description, r.subject, r.type, r.semester::int AS semester,
        r.exam_year::int AS exam_year, r.uploader_id, u.name AS uploader_name,
        f.size_bytes, f.mime_type, r.created_at, r.deleted_at, 0::float8 AS rank
      FROM hub_resources r JOIN users u ON u.id = r.uploader_id LEFT JOIN files f ON f.id = r.file_id
      WHERE r.id = ${id}::uuid`;
    if (!row) throw E.notFound();
    return toView(row, user);
  }

  /** Soft delete by the uploader or an admin (audited when an admin does it). */
  async function remove(
    user: User,
    params: unknown,
    requestId: Parameters<Platform['audit']['record']>[1]['requestId'],
  ) {
    const { id } = hub.HubIdParam.parse(params);
    await p.transaction(async (tx) => {
      const r = await tx.hubResource.findFirst({ where: { id, deletedAt: null } });
      if (!r) throw E.notFound();
      if (r.uploaderId !== user.id && user.role !== 'admin')
        throw E.forbidden('Only the uploader or an admin can delete this resource.');
      await tx.hubResource.update({ where: { id }, data: { deletedAt: new Date() } });
      if (user.role === 'admin')
        await p.audit.record(tx, {
          actorId: user.id,
          action: 'hub.resource_deleted',
          targetType: 'hub_resource',
          targetId: id,
          metadata: {
            subject: r.subject,
            type: r.type as hub.ResourceType,
            ownResource: r.uploaderId === user.id,
          },
          ...(requestId !== undefined && { requestId }),
        });
    });
  }

  return { list, adminList, subjects, create, remove };
}
