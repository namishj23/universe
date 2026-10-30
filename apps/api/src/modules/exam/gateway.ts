// Forwards /api/exam/<path> to the exam service (docs/integration/exam-service.md §2). The
// platform's guards (session, role, CSRF + Origin, password-change gate) have already run; the
// body is streamed, never parsed, and only an allow-list of headers crosses in either direction.
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream';
import type { RequestHandler } from 'express';
import type { Platform } from '../../platform/modules/index.js';
import type { ServiceConfig } from '../../platform/services.js';

export const MAX_BODY_BYTES = 200 * 1024 * 1024;
/** Read per request, so a test can shorten them. */
export const TIMEOUTS = { connectMs: 2_000, headersMs: 30_000 };
export const LIVE_MAX_MS = 2 * 60 * 60 * 1000;
const DRAIN_MS = 5_000;

const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const REQUEST_HEADERS = ['content-type', 'content-length', 'range', 'accept', 'if-none-match'];
const RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
  'content-disposition',
];

/** The headers the service gets: the service token, who is asking, and the allow-list. */
export function serviceHeaders(
  service: ServiceConfig,
  user: { id: string; role: string; name: string },
  requestId: string,
  incoming: IncomingMessage['headers'] = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of REQUEST_HEADERS) {
    const value = incoming[name];
    if (typeof value === 'string') out[name] = value;
  }
  return {
    ...out,
    'x-service-token': service.token,
    'x-universe-user-id': user.id,
    'x-universe-user-role': user.role,
    'x-universe-user-name': encodeURIComponent(user.name),
    'x-request-id': requestId,
  };
}

/** `.`/`..` segments (plain or encoded) and encoded slashes could leave `/exam/` upstream. */
function safePath(path: string): boolean {
  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)) return false;
  }
  return true;
}

export function gateway(platform: Platform, service: ServiceConfig): RequestHandler {
  const { ApiError } = platform.http;
  const base = service.url.href.replace(/\/+$/, '');
  const unavailable = () =>
    new ApiError(503, 'MODULE_UNAVAILABLE', 'Exam review is unavailable right now.');
  const tooLarge = () => new ApiError(413, 'FILE_TOO_LARGE', 'The upload is larger than 200 MB.');

  return (req, res, next) => {
    if (!METHODS.has(req.method)) return next();
    if (!safePath(req.path)) return next(new ApiError(404, 'NOT_FOUND', 'Not found'));
    // A refused body is drained, not forwarded: closing the socket while the client is still
    // sending makes it see a reset instead of the reply. A client that keeps sending for more
    // than 5 s after the reply loses the connection.
    const refuse = (err: InstanceType<typeof ApiError>) => {
      res.once('finish', () => {
        const cut = setTimeout(() => req.socket.destroy(), DRAIN_MS);
        cut.unref();
        req.once('end', () => clearTimeout(cut));
        req.resume();
      });
      next(err);
    };
    if (Number(req.get('content-length') ?? 0) > MAX_BODY_BYTES) return refuse(tooLarge());

    const { user } = platform.authOf(req);
    const q = req.originalUrl.indexOf('?');
    const target = new URL(`${base}/exam${req.path}${q >= 0 ? req.originalUrl.slice(q) : ''}`);
    const live = req.path.startsWith('/live/');
    const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: req.method,
      headers: serviceHeaders(service, user, typeof req.id === 'string' ? req.id : '', req.headers),
    });

    let settled = false; // a response or an error reply has been chosen
    let failed = false;
    const timers: NodeJS.Timeout[] = [];
    const clear = () => timers.forEach(clearTimeout);
    /** Before the response starts: one error reply. After: just drop the connection. */
    const fail = (err: InstanceType<typeof ApiError>, close = false) => {
      if (failed) return;
      failed = settled = true;
      clear();
      upstream.destroy();
      if (res.headersSent) res.destroy();
      else if (close) refuse(err);
      else next(err);
    };

    timers.push(setTimeout(() => fail(unavailable(), !req.complete), TIMEOUTS.connectMs));
    upstream.on('socket', (socket) => {
      const connected = () => clearTimeout(timers[0]);
      if (socket.connecting) socket.once('connect', connected);
      else connected();
    });
    // Live routes are long-lived streams: no header deadline, tracked instead.
    if (!live)
      timers.push(setTimeout(() => fail(unavailable(), !req.complete), TIMEOUTS.headersMs));
    upstream.on('error', () => fail(unavailable(), !req.complete));

    upstream.on('response', (up) => {
      if (settled) {
        up.resume();
        return;
      }
      settled = true;
      clear();
      res.status(up.statusCode ?? 502);
      for (const name of RESPONSE_HEADERS) {
        const value = up.headers[name];
        if (value !== undefined) res.setHeader(name, value);
      }
      // Set-Cookie and every other service header stay behind; the platform's own remain.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (live) platform.streams.track(req, res, { maxMs: LIVE_MAX_MS });
      pipeline(up, res, () => {});
    });

    // The client went away (or a tracked stream was closed): stop the service's work too.
    res.once('close', () => upstream.destroy());

    // Request body: streamed with back-pressure, counted on the way.
    let seen = 0;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      seen += chunk.length;
      if (seen > MAX_BODY_BYTES) {
        req.pause();
        fail(tooLarge(), true);
        return;
      }
      if (!upstream.write(chunk)) req.pause();
    });
    upstream.on('drain', () => req.resume());
    req.on('end', () => upstream.end());
    req.on('aborted', () => upstream.destroy());
  };
}
