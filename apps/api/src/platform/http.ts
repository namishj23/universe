import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { ApiErrorBody } from '@universe/contracts';
import { Prisma } from '../generated/prisma/client.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Express 4 does not catch rejected promises; this forwards them to the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

const uuid = z.uuid();

/** Reuses an incoming X-Request-Id only when it is a valid UUID. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && uuid.safeParse(incoming).success ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', 'Not found'));
};

/** body-parser errors carry an HTTP status and a type such as `entity.parse.failed`. */
const HttpError = z.object({ status: z.number().int().min(400).max(499), type: z.string() });
const httpErrorCodes: Record<string, [string, string]> = {
  'entity.parse.failed': ['INVALID_JSON', 'Request body is not valid JSON'],
  'entity.too.large': ['PAYLOAD_TOO_LARGE', 'Request body is too large'],
};

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof z.ZodError)
    return new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', z.flattenError(err));
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return new ApiError(409, 'CONFLICT', 'Resource already exists');
    if (err.code === 'P2025') return new ApiError(404, 'NOT_FOUND', 'Not found');
  }
  const http = HttpError.safeParse(err);
  if (http.success) {
    const [code, message] = httpErrorCodes[http.data.type] ?? ['BAD_REQUEST', 'Bad request'];
    return new ApiError(http.data.status, code, message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err); // e.g. an open SSE stream: let Express close the socket
  const apiError = toApiError(err);
  if (apiError.status >= 500) req.log.error({ err }, 'request failed');
  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: String(req.id),
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    },
  };
  res.status(apiError.status).json(body);
}
