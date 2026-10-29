// Browsing events and the sanitiser. Raw events come from the browser; only `{ at, kind, domain }`
// survives. The host name is all we keep: no scheme, credentials, port, path, query or fragment.

export const EVENT_KINDS = ['visit', 'focus', 'blur', 'idle', 'active'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** What a browser hands in. Any other field is dropped. */
export interface BrowsingEvent {
  at: string;
  kind: EventKind;
  url?: string;
  domain?: string;
}

/** A sanitised event: an ISO instant, a kind and (for most events) a host name. */
export interface CleanEvent {
  at: string;
  kind: EventKind;
  domain?: string;
}

export type RejectReason =
  | 'not_an_object'
  | 'bad_kind'
  | 'bad_timestamp'
  | 'future_timestamp'
  | 'bad_url'
  | 'unsupported_scheme'
  | 'bad_domain'
  | 'missing_domain';

export type SanitiseResult = { ok: true; event: CleanEvent } | { ok: false; reason: RejectReason };

/** The domain every IP literal and `localhost` maps to: time still counts, no address is kept. */
export const LOCAL_DOMAIN = 'local';
const FUTURE_LIMIT_MS = 24 * 3_600_000;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// Characters that may never reach a stored domain; checked on a bare `domain` before parsing.
const NOT_IN_HOST = /[/?#@:\\\s%]/;

type HostResult = { ok: true; domain: string } | { ok: false; reason: RejectReason };

/** The WHATWG URL parser lowercases, converts IDN to punycode and normalises IPv4 forms. */
function hostOf(url: URL): HostResult {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'unsupported_scheme' };
  let host = url.hostname.replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'bad_url' };
  if (
    host.startsWith('[') ||
    IPV4.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  )
    return { ok: true, domain: LOCAL_DOMAIN };
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host || NOT_IN_HOST.test(host)) return { ok: false, reason: 'bad_domain' };
  return { ok: true, domain: host };
}

function parse(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Normalises a bare host name (`Example.COM`, `bücher.de`) or rejects it. */
export function normaliseDomain(domain: string): HostResult {
  const trimmed = domain.trim();
  if (!trimmed || NOT_IN_HOST.test(trimmed)) return { ok: false, reason: 'bad_domain' };
  const url = parse(`http://${trimmed}/`);
  return url ? hostOf(url) : { ok: false, reason: 'bad_domain' };
}

/** Normalises a full URL to its domain or rejects it (non-http(s) schemes included). */
export function domainOfUrl(text: string): HostResult {
  const url = parse(text.trim());
  return url ? hostOf(url) : { ok: false, reason: 'bad_url' };
}

const isKind = (v: unknown): v is EventKind =>
  typeof v === 'string' && (EVENT_KINDS as readonly string[]).includes(v);

/**
 * Turns anything into a clean event or a reason. Never throws. `visit` needs a URL or domain;
 * `focus` and `active` may carry one; `blur` and `idle` never keep one.
 */
export function sanitiseEvent(raw: unknown, now: Date = new Date()): SanitiseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, reason: 'not_an_object' };
  const { at, kind, url, domain } = raw as Record<string, unknown>;
  if (!isKind(kind)) return { ok: false, reason: 'bad_kind' };
  const ms = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms)) return { ok: false, reason: 'bad_timestamp' };
  if (ms > now.getTime() + FUTURE_LIMIT_MS) return { ok: false, reason: 'future_timestamp' };
  const event: CleanEvent = { at: new Date(ms).toISOString(), kind };
  if (kind === 'blur' || kind === 'idle') return { ok: true, event };

  let host: HostResult | null = null;
  if (typeof url === 'string') host = domainOfUrl(url);
  else if (url !== undefined) return { ok: false, reason: 'bad_url' };
  else if (typeof domain === 'string') host = normaliseDomain(domain);
  else if (domain !== undefined) return { ok: false, reason: 'bad_domain' };
  if (host && !host.ok) return host;
  if (host) event.domain = host.domain;
  else if (kind === 'visit') return { ok: false, reason: 'missing_domain' };
  return { ok: true, event };
}

/** Sanitises a batch; rejected events are reported by index (for the "see my data" view). */
export function sanitiseEvents(raws: readonly unknown[], now: Date = new Date()) {
  const events: CleanEvent[] = [];
  const rejected: { index: number; reason: RejectReason }[] = [];
  raws.forEach((raw, index) => {
    const r = sanitiseEvent(raw, now);
    if (r.ok) events.push(r.event);
    else rejected.push({ index, reason: r.reason });
  });
  return { events, rejected };
}
