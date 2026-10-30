import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  attribute,
  CATEGORIES,
  computeMetrics,
  dailyTotals,
  sanitiseEvent,
  type CleanEvent,
  type FocusSession,
  type Rule,
  type Slice,
} from '../src/index.js';

const BASE = Date.UTC(2026, 9, 30, 4, 0); // 09:30 IST
const at = (min: number) => new Date(BASE + min * 60_000).toISOString();
const ev = (min: number, kind: CleanEvent['kind'], domain?: string): CleanEvent =>
  domain ? { at: at(min), kind, domain } : { at: at(min), kind };
const MIN = 60_000;
const rules: Rule[] = [
  { pattern: 'study.com', category: 'study', distracting: false },
  { pattern: 'fun.com', category: 'entertainment', distracting: true },
  { pattern: 'chat.com', category: 'communication', distracting: false },
];
const session = (end: number, pauses: [number, number][] = []): FocusSession => ({
  startedAt: at(0),
  endedAt: at(end),
  pauses: pauses.map(([a, b]) => ({ from: at(a), to: at(b) })),
});
const now = new Date(BASE + 10 * 60 * MIN);

describe('computeMetrics (hand-worked)', () => {
  it('caps each gap at the idle cap and counts switches between domains', () => {
    // study 0-3 (next event), fun 3-8 (cap), study 20-25 (cap), study 26-30 (end); 26 is a
    // repeat visit, not a switch.
    const events = [
      ev(0, 'visit', 'study.com'),
      ev(3, 'visit', 'fun.com'),
      ev(20, 'visit', 'study.com'),
      ev(26, 'visit', 'study.com'),
    ];
    const m = computeMetrics(session(30), events, rules, { now });
    expect(m.categoryMs.study).toBe(12 * MIN);
    expect(m.categoryMs.entertainment).toBe(5 * MIN);
    expect(m.distractingMs).toBe(5 * MIN);
    expect(m.switches).toBe(2);
    expect(m.activeMs).toBe(17 * MIN); // idle 8-20 beyond the cap
    expect(m.idleMs).toBe(13 * MIN);
  });

  it('stops attributing at blur and idle, and an idle stretch is never active', () => {
    const events = [
      ev(0, 'visit', 'study.com'),
      ev(2, 'blur'),
      ev(4, 'focus'),
      ev(6, 'idle'),
      ev(12, 'active'),
    ];
    const m = computeMetrics(session(15), events, rules, { now });
    // study 0-2, 4-6, 12-15; blur window 2-4 is active, idle 6-12 is not.
    expect(m.categoryMs.study).toBe(7 * MIN);
    expect(m.activeMs).toBe(9 * MIN);
    expect(m.switches).toBe(0);
    expect(m.countedEvents).toBe(5);
  });

  it('cuts at a pause start, ignores events in the pause and forgets the domain', () => {
    const events = [
      ev(0, 'visit', 'fun.com'),
      ev(4, 'visit', 'chat.com'),
      ev(10, 'focus'),
      ev(12, 'visit', 'study.com'),
    ];
    const m = computeMetrics(session(20, [[2, 8]]), events, rules, { now });
    expect(m.categoryMs.entertainment).toBe(2 * MIN); // 0-2, cut by the pause
    expect(m.categoryMs.communication).toBe(0); // inside the pause
    expect(m.categoryMs.study).toBe(5 * MIN); // 12-17; the focus at 10 has no domain to resume
    expect(m.switches).toBe(1); // fun → study (chat was paused)
    expect(m.countedEvents).toBe(3);
    expect(m.pausedMs).toBe(6 * MIN);
  });

  it('ignores events before the start and after the stop', () => {
    const events = [
      ev(-3, 'visit', 'fun.com'),
      ev(5, 'visit', 'study.com'),
      ev(12, 'visit', 'fun.com'),
    ];
    const m = computeMetrics(session(10), events, rules, { now });
    expect(m.categoryMs.entertainment).toBe(0);
    expect(m.categoryMs.study).toBe(5 * MIN);
    expect(m.countedEvents).toBe(1);
  });

  it('honours a custom idle cap', () => {
    const m = computeMetrics(session(30), [ev(0, 'visit', 'study.com')], rules, {
      now,
      idleCapSeconds: 60,
    });
    expect(m.categoryMs.study).toBe(MIN);
  });

  it('breaks time down per domain with an Other fallback', () => {
    const events = [ev(0, 'visit', 'unknown.org'), ev(2, 'visit', 'fun.com'), ev(3, 'blur')];
    const m = computeMetrics(session(5), events, rules, { now });
    expect(m.domains).toEqual([
      { domain: 'unknown.org', category: 'other', distracting: false, ms: 2 * MIN },
      { domain: 'fun.com', category: 'entertainment', distracting: true, ms: MIN },
    ]);
  });
});

describe('dailyTotals', () => {
  const slice = (from: number, to: number, category: Slice['category']): Slice => ({
    from,
    to,
    domain: 'x',
    category,
    distracting: false,
  });
  const IST_MIDNIGHT = Date.UTC(2026, 9, 29, 18, 30); // 30 Oct 00:00 IST

  it('splits at midnight in Asia/Kolkata', () => {
    expect(dailyTotals([slice(IST_MIDNIGHT - 10 * MIN, IST_MIDNIGHT + 20 * MIN, 'study')])).toEqual(
      [
        { date: '2026-10-29', category: 'study', minutes: 10 },
        { date: '2026-10-29', category: 'communication', minutes: 0 },
        { date: '2026-10-29', category: 'social', minutes: 0 },
        { date: '2026-10-29', category: 'entertainment', minutes: 0 },
        { date: '2026-10-30', category: 'study', minutes: 20 },
        { date: '2026-10-30', category: 'communication', minutes: 0 },
        { date: '2026-10-30', category: 'social', minutes: 0 },
        { date: '2026-10-30', category: 'entertainment', minutes: 0 },
      ],
    );
  });

  it('splits at midnight in another time zone too', () => {
    const rows = dailyTotals([slice(IST_MIDNIGHT - 10 * MIN, IST_MIDNIGHT + 20 * MIN, 'study')], {
      timeZone: 'America/New_York',
      categories: ['study'],
    });
    expect(rows).toEqual([{ date: '2026-10-29', category: 'study', minutes: 30 }]);
  });

  it('leaves out categories the user does not count', () => {
    const rows = dailyTotals(
      [slice(BASE, BASE + 5 * MIN, 'other'), slice(BASE, BASE + MIN, 'social')],
      {
        categories: ['social'],
      },
    );
    expect(rows).toEqual([{ date: '2026-10-30', category: 'social', minutes: 1 }]);
  });

  it('rounds so the rows sum to the rounded day total (largest remainder)', () => {
    // 40 s + 40 s + 40 s = 120 s → 2 minutes, given to the first two in category order.
    const rows = dailyTotals(
      [
        slice(BASE, BASE + 40_000, 'study'),
        slice(BASE, BASE + 40_000, 'communication'),
        slice(BASE, BASE + 40_000, 'social'),
      ],
      { categories: ['study', 'communication', 'social'] },
    );
    expect(rows.map((r) => r.minutes)).toEqual([1, 1, 0]);
  });
});

// ── Properties ──────────────────────────────────────────────────────────────────────────
const DOMAINS = ['study.com', 'fun.com', 'chat.com', 'other.org'];
const eventArb = fc.record({
  min: fc.integer({ min: -10, max: 130 }),
  kind: fc.constantFrom('visit', 'focus', 'blur', 'idle', 'active' as const),
  domain: fc.option(fc.constantFrom(...DOMAINS), { nil: undefined }),
});
const toEvents = (xs: { min: number; kind: CleanEvent['kind']; domain: string | undefined }[]) =>
  xs.map((x) =>
    ev(
      x.min,
      x.kind,
      x.kind === 'visit'
        ? (x.domain ?? 'other.org')
        : x.kind === 'blur' || x.kind === 'idle'
          ? undefined
          : x.domain,
    ),
  );
const pausesArb = fc
  .array(fc.integer({ min: 0, max: 120 }), { maxLength: 6 })
  .map((xs) => [...new Set(xs)].sort((a, b) => a - b))
  .map((xs) => {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i] ?? 0, xs[i + 1] ?? 0]);
    return out;
  });

describe('properties', () => {
  it('a sanitised domain never contains / ? # @ or :', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.webUrl({ withQueryParameters: true, withFragments: true }), fc.string()),
        (url) => {
          const r = sanitiseEvent({ at: at(0), kind: 'visit', url }, now);
          if (r.ok) expect(r.event.domain).not.toMatch(/[/?#@:]/);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('category time never exceeds active time; switches ≤ counted − 1', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), pausesArb, (xs, pauses) => {
        const m = computeMetrics(session(120, pauses), toEvents(xs), rules, { now });
        const categories = CATEGORIES.reduce((s, c) => s + m.categoryMs[c], 0);
        expect(categories).toBeLessThanOrEqual(m.activeMs);
        expect(m.distractingMs).toBeLessThanOrEqual(categories);
        expect(m.activeMs + m.pausedMs).toBeLessThanOrEqual(m.sessionMs);
        expect(m.switches).toBeLessThanOrEqual(Math.max(0, m.countedEvents - 1));
        const minutes = dailyTotals(attribute(session(120, pauses), toEvents(xs), rules, { now }), {
          categories: [...CATEGORIES],
        }).reduce((s, r) => s + r.minutes, 0);
        expect(minutes).toBeLessThanOrEqual(Math.round(m.activeMs / MIN) + 1);
      }),
    );
  });

  it('gives identical results for any input order', () => {
    fc.assert(
      fc.property(
        fc
          .array(eventArb, { maxLength: 30 })
          .chain((xs) =>
            fc.tuple(
              fc.constant(xs),
              fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }),
            ),
          ),
        pausesArb,
        ([xs, shuffled], pauses) => {
          const s = session(120, pauses);
          expect(computeMetrics(s, toEvents(shuffled), rules, { now })).toEqual(
            computeMetrics(s, toEvents(xs), rules, { now }),
          );
        },
      ),
    );
  });

  it('adding a pause never increases any total', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { maxLength: 30 }),
        pausesArb,
        fc.integer({ min: 0, max: 119 }),
        fc.integer({ min: 1, max: 30 }),
        (xs, pauses, from, len) => {
          const events = toEvents(xs);
          const before = computeMetrics(session(120, pauses), events, rules, { now });
          const after = computeMetrics(
            session(120, [...pauses, [from, Math.min(120, from + len)]]),
            events,
            rules,
            { now },
          );
          expect(after.activeMs).toBeLessThanOrEqual(before.activeMs);
          expect(after.distractingMs).toBeLessThanOrEqual(before.distractingMs);
          expect(after.switches).toBeLessThanOrEqual(before.switches);
          for (const c of CATEGORIES)
            expect(after.categoryMs[c]).toBeLessThanOrEqual(before.categoryMs[c]);
          for (const d of after.domains)
            expect(d.ms).toBeLessThanOrEqual(
              before.domains.find((x) => x.domain === d.domain)?.ms ?? 0,
            );
        },
      ),
      { numRuns: 300 },
    );
  });
});
