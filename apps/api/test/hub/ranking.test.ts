// Hand-worked mentor ranking (docs/sessions/P4-plan.md and docs/ALGORITHMS.md "Module A").
import { describe, expect, it } from 'vitest';
import {
  jaccard,
  makeNormaliser,
  rankMentors,
  reasonFor,
  weakestTopics,
  type MentorCandidate,
  type TrackedTopic,
} from '../../src/modules/hub/ranking.js';
import { TOPICS } from '../../src/modules/hub/seed.js';

const norm = makeNormaliser(TOPICS);
const topic = (id: string, solved: number): TrackedTopic => {
  const t = TOPICS.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return { topicId: t.id, name: t.name, tag: t.tag, sort: t.sort, solved, total: t.totalItems };
};
const mentor = (m: Partial<MentorCandidate> & { name: string }): MentorCandidate => ({
  id: m.name,
  expertise: [],
  interests: [],
  capacity: 3,
  mentees: 0,
  openSlots: 0,
  ...m,
});

// The seed's four mentors.
const MENTORS = [
  mentor({
    name: 'Prof. Kavita Nair',
    expertise: ['Trees', 'DP', 'OS'],
    capacity: 8,
    mentees: 5,
    openSlots: 3,
  }),
  mentor({ name: 'Prof. Arjun Menon', expertise: ['Greedy', 'CN'], openSlots: 4 }),
  mentor({ name: 'Dr. Sameer Joshi', expertise: ['Graphs', 'Greedy'], openSlots: 1 }),
  mentor({
    name: 'Prof. Neha Iyer',
    expertise: ['DP', 'Graphs', 'System design'],
    mentees: 1,
    openSlots: 2,
  }),
];
const AARAV = [
  topic('dsa-arrays', 44),
  topic('dsa-linked-lists', 18),
  topic('dsa-trees', 21),
  topic('dsa-graphs', 16),
  topic('dsa-dp', 11),
  topic('dsa-greedy', 8),
];
const AARAV_INTERESTS = new Set(['Graphs', 'Dynamic Programming', 'System design'].map(norm));

describe('normalisation', () => {
  it('trims, lowercases and maps topic names to their tag', () => {
    expect(norm('  Dynamic   Programming ')).toBe('dp');
    expect(norm('DP')).toBe('dp');
    expect(norm('Graphs')).toBe('graphs');
    expect(norm('Operating Systems')).toBe('os');
    expect(norm('System design')).toBe('system design');
  });

  it('computes Jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('weak topics', () => {
  it("picks Aarav's three weakest: DP .686, Greedy .680, Graphs .467", () => {
    const w = weakestTopics(AARAV);
    expect(w.map((t) => t.topicId)).toEqual(['dsa-dp', 'dsa-greedy', 'dsa-graphs']);
    expect(w.map((t) => +t.weakness.toFixed(4))).toEqual([0.6857, 0.68, 0.4667]);
  });

  it('breaks weakness ties by catalogue sort', () => {
    const w = weakestTopics(
      [topic('dsa-greedy', 0), topic('dsa-trees', 0), topic('dsa-arrays', 0)],
      2,
    );
    expect(w.map((t) => t.topicId)).toEqual(['dsa-arrays', 'dsa-trees']);
  });
});

describe('ranking', () => {
  it('ranks the seed mentors for Aarav by the hand-worked scores', () => {
    const ranked = rankMentors(MENTORS, weakestTopics(AARAV), AARAV_INTERESTS, norm);
    expect(ranked.map((r) => r.candidate.name)).toEqual([
      'Prof. Neha Iyer',
      'Dr. Sameer Joshi',
      'Prof. Arjun Menon',
      'Prof. Kavita Nair',
    ]);
    const [neha, sameer, arjun, kavita] = ranked;
    // Neha: coverage (.6857 + .4667) / 1.8324 = .6289, Jaccard 3/3, match .7217, avail .5, load 1/3.
    expect(neha?.components.weakTopicCoverage).toBeCloseTo(0.6289, 4);
    expect(neha?.components.interestOverlap).toBe(1);
    expect(neha?.components.match).toBeCloseTo(0.7217, 4);
    expect(neha?.components.availability).toBe(0.5);
    expect(neha?.components.load).toBeCloseTo(1 / 3, 6);
    expect(neha?.score).toBeCloseTo(0.6663, 4);
    // Sameer: coverage .6258, Jaccard 1/4, avail .25, load 0.
    expect(sameer?.components.weakTopicCoverage).toBeCloseTo(0.6258, 4);
    expect(sameer?.components.interestOverlap).toBe(0.25);
    expect(sameer?.score).toBeCloseTo(0.5691, 4);
    // Arjun: coverage .68 / 1.8324 = .3711, no shared interests, avail 1, load 0.
    expect(arjun?.components.weakTopicCoverage).toBeCloseTo(0.3711, 4);
    expect(arjun?.score).toBeCloseTo(0.567, 4);
    // Kavita: coverage .3742 (DP only), Jaccard 1/5, avail .75, load 5/8.
    expect(kavita?.components.interestOverlap).toBe(0.2);
    expect(kavita?.components.load).toBe(0.625);
    expect(kavita?.score).toBeCloseTo(0.4234, 4);
    expect(neha && reasonFor(neha, weakestTopics(AARAV))).toBe(
      'Covers two of your weakest topics: Dynamic Programming and Graphs.',
    );
  });

  it('puts a different mentor on top for a different prep state', () => {
    // Weak on Trees and OS only: Kavita covers both.
    const tracked = [topic('dsa-trees', 3), topic('core-os', 2)];
    const ranked = rankMentors(MENTORS, weakestTopics(tracked), new Set(), norm);
    expect(ranked[0]?.candidate.name).toBe('Prof. Kavita Nair');
    expect(ranked[0]?.components.weakTopicCoverage).toBe(1);
    // 0.6 × 0.75 + 0.2 × 0.75 + 0.2 × 0.375 = 0.675
    expect(ranked[0]?.score).toBeCloseTo(0.675, 6);
  });

  it('breaks score ties by more free slots, then name', () => {
    const tied = [
      mentor({ name: 'Zed', capacity: 2, mentees: 1, openSlots: 1 }), // 0.2 × .25 + 0.2 × .5 = .15
      mentor({ name: 'Bea', capacity: 4, mentees: 2, openSlots: 1 }), // same score, same slots
      mentor({ name: 'Amy', capacity: 1, mentees: 1, openSlots: 3 }), // 0.2 × .75 + 0 = .15, more slots
    ];
    const ranked = rankMentors(tied, [], new Set(), norm);
    expect(ranked.map((r) => r.score.toFixed(6))).toEqual(['0.150000', '0.150000', '0.150000']);
    expect(ranked.map((r) => r.candidate.name)).toEqual(['Amy', 'Bea', 'Zed']);
  });

  it('treats capacity 0 as full load and a student with no tracked topics as zero coverage', () => {
    const [r] = rankMentors(
      [mentor({ name: 'Off', capacity: 0, expertise: ['DP'] })],
      [],
      new Set(),
      norm,
    );
    expect(r?.components.load).toBe(1);
    expect(r?.components.weakTopicCoverage).toBe(0);
    expect(r?.score).toBe(0);
  });
});
