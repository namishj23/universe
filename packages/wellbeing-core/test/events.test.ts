import { describe, expect, it } from 'vitest';
import { sanitiseEvent, sanitiseEvents } from '../src/index.js';

const now = new Date('2026-10-30T10:00:00Z');
const at = '2026-10-30T09:00:00.000Z';
const domainOf = (url: string) => {
  const r = sanitiseEvent({ at, kind: 'visit', url }, now);
  return r.ok ? r.event.domain : r.reason;
};

describe('sanitiseEvent', () => {
  it.each([
    ['https://user:pass@Sub.Example.COM:8443/a/b?c=d#e', 'sub.example.com'],
    ['http://www.youtube.com/watch?v=1', 'youtube.com'],
    ['https://www.www.example.com/', 'www.example.com'],
    ['https://example.com./x', 'example.com'],
    ['https://bücher.de/katalog', 'xn--bcher-kva.de'],
    ['https://उदाहरण.भारत/', 'xn--p1b6ci4b4b3a.xn--h2brj9c'],
    ['http://localhost:3000/', 'local'],
    ['http://api.localhost/', 'local'],
    ['http://127.0.0.1:8080/x', 'local'],
    ['http://0x7f.1/', 'local'],
    ['http://[::1]:5173/', 'local'],
    ['file:///etc/passwd', 'unsupported_scheme'],
    ['chrome://settings', 'unsupported_scheme'],
    ['about:blank', 'unsupported_scheme'],
    ['data:text/html,hi', 'unsupported_scheme'],
    ['javascript:alert(1)', 'unsupported_scheme'],
    ['ftp://example.com/', 'unsupported_scheme'],
    ['not a url', 'bad_url'],
    ['http://exa mple.com/', 'bad_url'],
  ])('%s → %s', (url, expected) => {
    expect(domainOf(url)).toBe(expected);
  });

  it('keeps only at, kind and domain, and normalises the timestamp', () => {
    expect(
      sanitiseEvent(
        {
          at: '2026-10-30T14:30:00+05:30',
          kind: 'visit',
          url: 'https://a.com/x',
          title: 'secret',
          content: 'page text',
        },
        now,
      ),
    ).toEqual({ ok: true, event: { at: at, kind: 'visit', domain: 'a.com' } });
  });

  it('accepts a bare domain and rejects one with a path or credentials', () => {
    expect(sanitiseEvent({ at, kind: 'focus', domain: 'WWW.Reddit.com' }, now)).toEqual({
      ok: true,
      event: { at, kind: 'focus', domain: 'reddit.com' },
    });
    for (const domain of ['reddit.com/r/x', 'a@b.com', 'a.com:80', 'a.com?x', ' ', 'a b.com'])
      expect(sanitiseEvent({ at, kind: 'visit', domain }, now)).toEqual({
        ok: false,
        reason: 'bad_domain',
      });
  });

  it('drops the domain of blur and idle, and needs one for visit only', () => {
    expect(sanitiseEvent({ at, kind: 'blur', url: 'https://a.com' }, now)).toEqual({
      ok: true,
      event: { at, kind: 'blur' },
    });
    expect(sanitiseEvent({ at, kind: 'focus' }, now)).toEqual({
      ok: true,
      event: { at, kind: 'focus' },
    });
    expect(sanitiseEvent({ at, kind: 'visit' }, now)).toEqual({
      ok: false,
      reason: 'missing_domain',
    });
  });

  it.each([
    [null, 'not_an_object'],
    ['visit', 'not_an_object'],
    [[1], 'not_an_object'],
    [{ at, kind: 'scroll' }, 'bad_kind'],
    [{ at: 'yesterday', kind: 'idle' }, 'bad_timestamp'],
    [{ at: 12345, kind: 'idle' }, 'bad_timestamp'],
    [{ at: '2026-10-31T10:00:01Z', kind: 'idle' }, 'future_timestamp'],
    [{ at, kind: 'visit', url: 42 }, 'bad_url'],
    [{ at, kind: 'visit', domain: 42 }, 'bad_domain'],
  ])('rejects %j with %s and never throws', (raw, reason) => {
    expect(sanitiseEvent(raw, now)).toEqual({ ok: false, reason });
  });

  it('allows up to 24 hours ahead (clock skew)', () => {
    expect(sanitiseEvent({ at: '2026-10-31T10:00:00Z', kind: 'idle' }, now).ok).toBe(true);
  });

  it('reports rejected events by index', () => {
    const r = sanitiseEvents(
      [
        { at, kind: 'idle' },
        { at, kind: 'nope' },
      ],
      now,
    );
    expect(r.events).toHaveLength(1);
    expect(r.rejected).toEqual([{ index: 1, reason: 'bad_kind' }]);
  });
});
