import { describe, expect, it } from 'vitest';
import { compileRules, DEFAULT_RULES, validatePattern, validateRules } from '../src/index.js';

describe('validatePattern', () => {
  it.each([
    ['YouTube.com', 'youtube.com'],
    ['www.youtube.com', 'youtube.com'],
    ['*.Google.com', '*.google.com'],
    ['*.उदाहरण.भारत', '*.xn--p1b6ci4b4b3a.xn--h2brj9c'],
    ['local', 'local'],
  ])('%s → %s', (input, pattern) => {
    expect(validatePattern(input)).toEqual({ ok: true, pattern });
  });

  it.each([
    ['', 'empty'],
    ['youtube.com/watch', 'not_a_domain'],
    ['https://youtube.com', 'not_a_domain'],
    ['*youtube.com', 'not_a_domain'],
    ['you*.com', 'not_a_domain'],
    ['.*\\.com', 'not_a_domain'],
    ['[a-z]+.com', 'not_a_domain'],
    ['a.com:80', 'not_a_domain'],
    ['-bad.com', 'not_a_domain'],
    ['*.', 'not_a_domain'],
    ['a'.repeat(254), 'too_long'],
  ])('rejects %j (%s)', (input, reason) => {
    expect(validatePattern(input)).toEqual({ ok: false, reason });
  });
});

describe('validateRules', () => {
  it('reports every bad rule by index, including duplicates after normalising', () => {
    expect(
      validateRules([
        { pattern: 'a.com', category: 'study', distracting: false },
        { pattern: 'WWW.A.com', category: 'social', distracting: true },
        { pattern: 'b.com', category: 'games', distracting: false },
        { pattern: 'c.com', category: 'social', distracting: 'yes' },
        null,
      ]),
    ).toEqual({
      ok: false,
      errors: [
        { index: 1, reason: 'duplicate_pattern' },
        { index: 2, reason: 'bad_category' },
        { index: 3, reason: 'bad_distracting' },
        { index: 4, reason: 'not_a_domain' },
      ],
    });
  });

  it('accepts the defaults, and none of them is distracting', () => {
    const r = validateRules(DEFAULT_RULES);
    expect(r.ok).toBe(true);
    expect(DEFAULT_RULES.some((x) => x.distracting)).toBe(false);
  });
});

describe('classify', () => {
  const classify = compileRules([
    { pattern: '*.google.com', category: 'other', distracting: false },
    { pattern: '*.mail.google.com', category: 'communication', distracting: false },
    { pattern: 'docs.google.com', category: 'study', distracting: false },
    { pattern: '*.youtube.com', category: 'entertainment', distracting: true },
  ]);

  it('prefers an exact domain over any wildcard', () => {
    expect(classify('docs.google.com').category).toBe('study');
  });
  it('prefers a longer wildcard over a shorter one', () => {
    expect(classify('inbox.mail.google.com').category).toBe('communication');
    expect(classify('mail.google.com').category).toBe('communication');
    expect(classify('drive.google.com').category).toBe('other');
  });
  it('lets a wildcard match the bare domain and any depth of subdomain', () => {
    expect(classify('youtube.com')).toEqual({
      category: 'entertainment',
      distracting: true,
      pattern: '*.youtube.com',
    });
    expect(classify('a.b.m.youtube.com').distracting).toBe(true);
  });
  it('never matches on a partial label', () => {
    expect(classify('notyoutube.com')).toEqual({
      category: 'other',
      distracting: false,
      pattern: null,
    });
  });
  it('sends unmatched domains to Other, not distracting', () => {
    expect(classify('example.org')).toEqual({
      category: 'other',
      distracting: false,
      pattern: null,
    });
  });
});
