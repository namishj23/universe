// Mentor ranking (the module's key algorithm; docs/ALGORITHMS.md "Module A"). Pure functions:
// the services load the data in one query and call these.
import { config } from './config.js';

type Weights = typeof config.ranking;

const clean = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/** Trim, lowercase and map a topic's name to its tag ("Dynamic Programming" → "dp"). */
export function makeNormaliser(topics: readonly { name: string; tag: string }[]) {
  const alias = new Map<string, string>();
  for (const t of topics) {
    alias.set(clean(t.name), clean(t.tag));
    alias.set(clean(t.tag), clean(t.tag));
  }
  return (s: string) => {
    const c = clean(s);
    return alias.get(c) ?? c;
  };
}
export type Normaliser = ReturnType<typeof makeNormaliser>;

export interface TrackedTopic {
  topicId: string;
  name: string;
  tag: string;
  sort: number;
  solved: number;
  total: number;
}

export interface WeakTopic {
  topicId: string;
  name: string;
  tag: string;
  weakness: number;
}

/** The `n` tracked topics with the highest weakness 1 − solved/total; ties by catalogue sort. */
export function weakestTopics(
  tracked: readonly TrackedTopic[],
  n: number = config.ranking.weakTopics,
): WeakTopic[] {
  return tracked
    .map((t) => ({ t, weakness: t.total > 0 ? 1 - t.solved / t.total : 0 }))
    .sort((a, b) => b.weakness - a.weakness || a.t.sort - b.t.sort)
    .slice(0, n)
    .map(({ t, weakness }) => ({ topicId: t.topicId, name: t.name, tag: t.tag, weakness }));
}

export interface MentorCandidate {
  id: string;
  name: string;
  expertise: readonly string[];
  interests: readonly string[];
  capacity: number;
  /** Accepted, not completed mentees. */
  mentees: number;
  /** Open slots starting in the window. */
  openSlots: number;
}

export interface Components {
  match: number;
  weakTopicCoverage: number;
  interestOverlap: number;
  availability: number;
  load: number;
}

export interface Scored<C extends MentorCandidate> {
  candidate: C;
  score: number;
  components: Components;
  /** The weak topics this mentor covers, weakest first. */
  covered: WeakTopic[];
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  const union = a.size + b.size - both;
  return union === 0 ? 0 : both / union;
}

export function scoreMentor<C extends MentorCandidate>(
  c: C,
  weak: readonly WeakTopic[],
  interests: ReadonlySet<string>,
  norm: Normaliser,
  w: Weights = config.ranking,
): Scored<C> {
  const expertise = new Set(c.expertise.map(norm));
  const covered = weak.filter((t) => expertise.has(norm(t.tag)));
  const weakSum = weak.reduce((s, t) => s + t.weakness, 0);
  const weakTopicCoverage = weakSum > 0 ? covered.reduce((s, t) => s + t.weakness, 0) / weakSum : 0;
  const interestOverlap = jaccard(interests, new Set([...expertise, ...c.interests.map(norm)]));
  const match =
    w.matchWeights.coverage * weakTopicCoverage + w.matchWeights.interests * interestOverlap;
  const availability = Math.min(1, c.openSlots / w.slotsForFullAvailability);
  const load = c.capacity <= 0 ? 1 : Math.min(1, c.mentees / c.capacity);
  const score =
    w.weights.match * match +
    w.weights.availability * availability +
    w.weights.freeCapacity * (1 - load);
  return {
    candidate: c,
    score,
    components: { match, weakTopicCoverage, interestOverlap, availability, load },
    covered,
  };
}

/** Highest score first; ties by more open slots, then name. O(M log M) after O(M·(T+E)) scoring. */
export function rankMentors<C extends MentorCandidate>(
  candidates: readonly C[],
  weak: readonly WeakTopic[],
  interests: ReadonlySet<string>,
  norm: Normaliser,
  w: Weights = config.ranking,
): Scored<C>[] {
  return candidates
    .map((c) => scoreMentor(c, weak, interests, norm, w))
    .sort(
      (a, b) =>
        (Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : 0) ||
        b.candidate.openSlots - a.candidate.openSlots ||
        a.candidate.name.localeCompare(b.candidate.name, 'en'),
    );
}

const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const NUMBER = ['no', 'one', 'two', 'three'];

/**
 * One plain line built from the components, e.g. "Covers your two weakest topics: Dynamic
 * Programming and Graphs." `whose` is "your" for a student and "students'" for the admin view.
 */
export function reasonFor(
  s: Scored<MentorCandidate>,
  weak: readonly WeakTopic[],
  whose = 'your',
): string {
  const parts: string[] = [];
  const names = s.covered.map((t) => t.name);
  if (weak.length === 0) parts.push(`Add topics to the prep tracker to match on weak topics.`);
  else if (names.length === 0) parts.push(`Doesn't cover ${whose} weakest topics.`);
  else if (names.length === weak.length && names.length > 1)
    parts.push(
      `Covers ${whose} ${NUMBER[names.length] ?? names.length} weakest topics: ${list(names)}.`,
    );
  else if (names.length === 1 && s.covered[0]?.topicId === weak[0]?.topicId)
    parts.push(`Covers ${whose} weakest topic, ${list(names)}.`);
  else
    parts.push(
      `Covers ${NUMBER[names.length] ?? names.length} of ${whose} weakest topics: ${list(names)}.`,
    );
  const slots = s.candidate.openSlots;
  if (slots === 0) parts.push('No free slots this week.');
  else if (slots === 1) parts.push('One free slot left this week.');
  if (s.candidate.mentees > 0 && s.components.load >= 0.5)
    parts.push(`Currently mentoring ${s.candidate.mentees} students.`);
  return parts.join(' ');
}

/** 4 decimals for the API; ranking uses the exact values. */
export const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
