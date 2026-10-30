// User-defined categorisation rules. A pattern is an exact domain (`youtube.com`) or a wildcard on
// subdomains (`*.google.com`, which also matches `google.com` itself). No paths, no regex.
// Precedence: exact over wildcard, longer wildcard over shorter; unmatched → Other, not distracting.
import { normaliseDomain } from './events.js';

export const CATEGORIES = ['study', 'communication', 'social', 'entertainment', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Rule {
  pattern: string;
  category: Category;
  distracting: boolean;
}

export type PatternResult =
  { ok: true; pattern: string } | { ok: false; reason: 'empty' | 'not_a_domain' | 'too_long' };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Validates and normalises a pattern (lowercase, IDN → punycode, no leading `www.`). */
export function validatePattern(input: string): PatternResult {
  const text = input.trim().toLowerCase();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > 253) return { ok: false, reason: 'too_long' };
  const wildcard = text.startsWith('*.');
  const host = normaliseDomain(wildcard ? text.slice(2) : text);
  if (!host.ok || !host.domain.split('.').every((l) => LABEL.test(l)))
    return { ok: false, reason: 'not_a_domain' };
  return { ok: true, pattern: wildcard ? `*.${host.domain}` : host.domain };
}

export type RulesResult =
  { ok: true; rules: Rule[] } | { ok: false; errors: { index: number; reason: string }[] };

const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);

/** Validates a whole rule list: patterns, categories, flags and duplicate patterns. */
export function validateRules(input: readonly unknown[]): RulesResult {
  const rules: Rule[] = [];
  const errors: { index: number; reason: string }[] = [];
  const seen = new Set<string>();
  const check = (raw: unknown): Rule | string => {
    const { pattern, category, distracting } = (raw ?? {}) as Record<string, unknown>;
    if (typeof pattern !== 'string') return 'not_a_domain';
    const p = validatePattern(pattern);
    if (!p.ok) return p.reason;
    if (!isCategory(category)) return 'bad_category';
    if (typeof distracting !== 'boolean') return 'bad_distracting';
    if (seen.has(p.pattern)) return 'duplicate_pattern';
    seen.add(p.pattern);
    return { pattern: p.pattern, category, distracting };
  };
  input.forEach((raw, index) => {
    const r = check(raw);
    if (typeof r === 'string') errors.push({ index, reason: r });
    else rules.push(r);
  });
  return errors.length ? { ok: false, errors } : { ok: true, rules };
}

export interface Classification {
  category: Category;
  distracting: boolean;
  /** The rule that matched, or null for the Other fallback. */
  pattern: string | null;
}

export type Classifier = (domain: string) => Classification;

const OTHER: Classification = { category: 'other', distracting: false, pattern: null };

/** Compiles validated rules into a fast classifier. Later duplicates of a pattern are ignored. */
export function compileRules(rules: readonly Rule[]): Classifier {
  const exact = new Map<string, Classification>();
  const wild = new Map<string, Classification>();
  for (const r of rules) {
    const target = r.pattern.startsWith('*.') ? wild : exact;
    const key = r.pattern.startsWith('*.') ? r.pattern.slice(2) : r.pattern;
    if (!target.has(key))
      target.set(key, { category: r.category, distracting: r.distracting, pattern: r.pattern });
  }
  return (domain) => {
    const hit = exact.get(domain);
    if (hit) return hit;
    // Walk up the labels: the first (longest) wildcard suffix wins.
    for (let suffix = domain; ;) {
      const w = wild.get(suffix);
      if (w) return w;
      const dot = suffix.indexOf('.');
      if (dot < 0) return OTHER;
      suffix = suffix.slice(dot + 1);
    }
  };
}

const rule = (category: Category, ...patterns: string[]): Rule[] =>
  patterns.map((pattern) => ({ pattern, category, distracting: false }));

/**
 * Starting rules the user edits. Nothing is distracting until the user marks it: the problem
 * statement asks for time on "user-designated" distracting sites.
 */
export const DEFAULT_RULES: readonly Rule[] = Object.freeze([
  ...rule(
    'study',
    'docs.google.com',
    'scholar.google.com',
    'classroom.google.com',
    '*.wikipedia.org',
    '*.stackoverflow.com',
    '*.github.com',
    '*.geeksforgeeks.org',
    '*.leetcode.com',
    '*.coursera.org',
    '*.khanacademy.org',
    '*.nptel.ac.in',
    '*.w3schools.com',
    '*.developer.mozilla.org',
  ),
  ...rule(
    'communication',
    'mail.google.com',
    'meet.google.com',
    '*.outlook.com',
    'outlook.live.com',
    'web.whatsapp.com',
    '*.slack.com',
    'teams.microsoft.com',
    '*.discord.com',
    '*.zoom.us',
  ),
  ...rule(
    'social',
    '*.instagram.com',
    '*.facebook.com',
    '*.x.com',
    '*.twitter.com',
    '*.linkedin.com',
    '*.reddit.com',
    '*.snapchat.com',
    '*.pinterest.com',
  ),
  ...rule(
    'entertainment',
    '*.youtube.com',
    '*.netflix.com',
    '*.primevideo.com',
    '*.hotstar.com',
    '*.spotify.com',
    '*.twitch.tv',
    '*.jiocinema.com',
  ),
]);
