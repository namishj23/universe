// Module E, Exam Review (Person 1): the platform side of docs/integration/exam-service.md. The
// review itself runs in the exam service (services/exam/); this module forwards the browser's
// calls to it, shows its dashboard card, and takes its activity, audit and live-progress calls.
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  EXAM_ACTIVITY_TEXT,
  examActivityParams,
  exam as contracts,
  type ExamActivityType,
} from '@universe/contracts';
import type { ModuleFactory, Platform } from '../../platform/modules/index.js';
import type { ServiceConfig } from '../../platform/services.js';
import { gateway, serviceHeaders } from './gateway.js';

/** Requests per minute per user through the gateway (clip pages fetch video ranges). */
export const GATEWAY_RATE_PER_MINUTE = 600;
const REVIEWERS = ['invigilator', 'admin'] as const;

function internalRoutes(platform: Platform) {
  const { ApiError, asyncHandler } = platform.http;
  const reviewers = (ids: readonly string[]) =>
    platform.prisma.user.findMany({
      where: { id: { in: [...ids] }, isActive: true, role: { in: [...REVIEWERS] } },
      select: { id: true },
    });
  const notReviewers = () =>
    new ApiError(422, 'INVALID_RECIPIENT', 'Every user must be an active invigilator or admin');

  return (router: Router) => {
    router.post(
      '/activity',
      asyncHandler(async (req, res) => {
        const body = contracts.ExamActivityRequest.parse(req.body);
        const type: ExamActivityType = body.type;
        // Strict per type: ids, counts and a seat label only, so no free text gets in.
        const params = examActivityParams[type].parse(body.params);
        const recipients =
          'role' in body.recipients
            ? await platform.prisma.user.findMany({
                where: { role: 'invigilator', isActive: true },
                select: { id: true },
              })
            : await reviewers(body.recipients.userIds);
        if (
          'userIds' in body.recipients &&
          recipients.length !== new Set(body.recipients.userIds).size
        )
          throw notReviewers();
        const message = (EXAM_ACTIVITY_TEXT[type] as (p: typeof params) => string)(params);
        await platform.transaction(async (tx, emit) => {
          if (!(await platform.serviceEvents.claim(tx, 'exam', body.idempotencyKey))) return;
          await emit({
            recipients: recipients.map((r) => r.id),
            module: 'exam',
            type,
            payload: { ...params, message },
          });
        });
        res.status(202).json({ accepted: true });
      }),
    );

    router.post(
      '/audit',
      asyncHandler(async (req, res) => {
        const body = contracts.ExamAuditRequest.parse(req.body);
        if ((await reviewers([body.actorUserId])).length !== 1)
          throw new ApiError(
            422,
            'INVALID_ACTOR',
            'The actor must be an active invigilator or admin',
          );
        await platform.transaction(async (tx) => {
          if (!(await platform.serviceEvents.claim(tx, 'exam', body.idempotencyKey))) return;
          await platform.audit.record(tx, {
            actorId: body.actorUserId,
            action: body.action,
            targetType: body.targetType,
            targetId: body.targetId,
            metadata: body.meta,
            requestId: req.id,
          });
        });
        res.status(202).json({ accepted: true });
      }),
    );

    router.post(
      '/push',
      asyncHandler(async (req, res) => {
        const body = contracts.ExamPushRequest.parse(req.body);
        if ((await reviewers([body.userId])).length !== 1) throw notReviewers();
        const first =
          body.idempotencyKey === undefined ||
          (await platform.serviceEvents.claim(platform.prisma, 'exam', body.idempotencyKey));
        if (first) platform.pushEvent([body.userId], body.event, body.data);
        res.status(202).json({ accepted: true });
      }),
    );
  };
}

/** The dashboard card: the service's `dashboard-summary`, asked as the signed-in user. */
const dashboardSummary =
  (service: ServiceConfig) =>
  async (user: { id: string; role: string; name: string }, signal: AbortSignal) => {
    const base = service.url.href.replace(/\/+$/, '');
    const res = await fetch(`${base}/exam/dashboard-summary`, {
      headers: serviceHeaders(service, user, crypto.randomUUID(), { accept: 'application/json' }),
      signal,
    });
    if (!res.ok) throw new Error(`exam dashboard-summary: ${res.status}`);
    return res.json();
  };

const exam: ModuleFactory = (platform) => {
  const service = platform.services.get('exam');
  if (!service) return null; // not configured: not installed (absent from /api/modules, 404)
  const { ApiError } = platform.http;
  const router = Router()
    .use(
      rateLimit({
        windowMs: 60_000,
        limit: GATEWAY_RATE_PER_MINUTE,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        keyGenerator: (req) => platform.authOf(req).user.id,
        handler: (_req, _res, next) =>
          next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.')),
      }),
    )
    .use(gateway(platform, service));
  return {
    id: 'exam',
    label: 'Exam Review',
    order: 50,
    roles: [...REVIEWERS],
    router,
    rawBody: true,
    dashboardSummary: dashboardSummary(service),
    internalRoutes: internalRoutes(platform),
  };
};

export default exam;
