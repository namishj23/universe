import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attribute,
  computeMetrics,
  dailyTotals,
  sanitiseEvents,
  validateRules,
  type FocusSession,
} from '../src/index.js';

interface Sample {
  timeZone: string;
  now: string;
  idleCapSeconds: number;
  session: FocusSession;
  rules: unknown[];
  events: unknown[];
  expected: {
    rejected: unknown[];
    metrics: Record<string, unknown>;
    daily: unknown[];
  };
}

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')) as Sample;
const s = (ms: number) => ms / 1000;

describe.each(['day-1.json', 'day-2.json', 'day-3.json'])('sample %s', (file) => {
  const sample = load(file);
  const now = new Date(sample.now);
  const rules = validateRules(sample.rules);
  if (!rules.ok) throw new Error(JSON.stringify(rules.errors));
  const { events, rejected } = sanitiseEvents(sample.events, now);
  const options = { idleCapSeconds: sample.idleCapSeconds, now };

  it('rejects exactly the expected events', () => {
    expect(rejected).toEqual(sample.expected.rejected);
  });

  it('keeps nothing but at, kind and a bare host name', () => {
    for (const e of events) {
      expect(Object.keys(e).every((k) => ['at', 'kind', 'domain'].includes(k))).toBe(true);
      expect(e.domain ?? '').not.toMatch(/[/?#@:]/);
    }
    const kept = JSON.stringify(events);
    for (const secret of ['secret', 'hunter2', 'token', 'watch', 'private', 'alice', 'aarav'])
      expect(kept).not.toContain(secret);
  });

  it('matches the hand-checked metrics', () => {
    const m = computeMetrics(sample.session, events, rules.rules, options);
    expect({
      sessionSeconds: s(m.sessionMs),
      pausedSeconds: s(m.pausedMs),
      activeSeconds: s(m.activeMs),
      idleSeconds: s(m.idleMs),
      switches: m.switches,
      countedEvents: m.countedEvents,
      distractingSeconds: s(m.distractingMs),
      categorySeconds: Object.fromEntries(Object.entries(m.categoryMs).map(([k, v]) => [k, s(v)])),
      domains: m.domains.map(({ ms, ...d }) => ({ ...d, seconds: s(ms) })),
    }).toEqual(sample.expected.metrics);
  });

  it('matches the hand-checked daily rows', () => {
    const slices = attribute(sample.session, events, rules.rules, options);
    expect(dailyTotals(slices, { timeZone: sample.timeZone })).toEqual(sample.expected.daily);
  });
});
