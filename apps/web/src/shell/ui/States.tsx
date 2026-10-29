import type { ReactNode } from 'react';
import { ApiRequestError } from '../../platform/api';
import { Button } from './Button';
import { cx } from './cx';
import s from './States.module.css';

/** The design's loading panel: skeleton blocks and a mono caption. `what` is lower case. */
export function Loading({ what }: { what: string }) {
  return (
    <div className={s.loading} aria-busy="true">
      <div className={s.block} />
      <div className={s.cards}>
        <div className={cx(s.block, s.card)} />
        <div className={cx(s.block, s.card, s.d1)} />
        <div className={cx(s.block, s.card, s.d2)} />
      </div>
      <div className={cx(s.block, s.row)} />
      <div className={cx(s.block, s.row, s.d1)} />
      <span className={s.caption}>LOADING {what.toUpperCase()}…</span>
    </div>
  );
}

/** The dashed empty box. */
export function Empty({
  title,
  body,
  action,
  label = 'EMPTY',
}: {
  title: string;
  body: ReactNode;
  action?: { label: string; onClick: () => void } | undefined;
  label?: string;
}) {
  return (
    <div className={s.empty}>
      <span className={s.label}>{label}</span>
      <span className={s.title}>{title}</span>
      <span className={s.body}>{body}</span>
      {action && (
        <Button size="lg" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<number, string> = {
  400: 'BAD REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD TOO LARGE',
  415: 'UNSUPPORTED MEDIA TYPE',
  429: 'TOO MANY REQUESTS',
  500: 'INTERNAL SERVER ERROR',
  502: 'BAD GATEWAY',
  503: 'SERVICE UNAVAILABLE',
  504: 'GATEWAY TIMEOUT',
};

/** "503 SERVICE UNAVAILABLE", or NETWORK when the request never got an answer. */
export function errorStatusLabel(error: unknown) {
  if (error instanceof ApiRequestError)
    return `${error.status} ${STATUS_TEXT[error.status] ?? ''}`.trim();
  if (error instanceof TypeError) return 'NETWORK';
  return 'UNEXPECTED RESPONSE';
}

/** The error box: status, what failed, the request ID to quote, and a retry. */
export function ErrorBox({
  error,
  what,
  title,
  body = 'The rest of UniVerse still works. Try again, or quote this request ID if it keeps happening.',
  onRetry,
  retryLabel = 'Try again',
  children,
}: {
  error: unknown;
  what?: string;
  title?: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}) {
  const requestId = error instanceof ApiRequestError ? error.requestId : undefined;
  return (
    <div role="alert" className={s.error}>
      <span className={s.label}>ERROR · {errorStatusLabel(error)}</span>
      <span className={s.errorTitle}>{title ?? `Couldn't load ${what ?? 'this'}.`}</span>
      <span className={s.errorBody}>{body}</span>
      {requestId && <span className={s.requestId}>request_id {requestId}</span>}
      {children}
      {onRetry && (
        <button type="button" className={s.retry} onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
