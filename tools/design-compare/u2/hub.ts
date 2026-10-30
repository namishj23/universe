/**
 * Student Hub route mocks from the prototype's sample data (UniVerse App.dc.html: `prep`,
 * `requests`, MENTORS, RESOURCES, the profile card), in the API's response shapes and parsed
 * with the contracts' schemas, so a drifting fixture fails when this file loads.
 *
 * Differences on purpose: the prototype's mentor scores (0.92…) are kept although the seeded
 * API ranks Neha at 0.67; the accepted session has `rideLink: null` because the prototype
 * draws no ride line; subjects are the four chips it draws (the seed has seven).
 */
import type { Page } from '@playwright/test';
import { hub } from '../../../packages/contracts/src/index.ts';
import { USERS } from '../fixtures/index.ts';
import type { U2Module } from './index.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;
const at = (date: string, time: string) => `${date}T${time}:00+05:30`;

const PREP: [string, string, number, number][] = [
  ['arrays-strings', 'Arrays & Strings', 44, 50],
  ['linked-lists', 'Linked Lists', 18, 20],
  ['trees', 'Trees', 21, 30],
  ['graphs', 'Graphs', 16, 30],
  ['dynamic-programming', 'Dynamic Programming', 11, 35],
  ['greedy', 'Greedy', 8, 25],
];
const topics = PREP.map(([topicId, name, solved, total]) => ({
  topicId,
  track: 'dsa' as const,
  name,
  tag: name,
  solved,
  total,
  percent: Math.round((solved / total) * 100),
}));
const readiness = {
  score: 31,
  tracks: { dsa: 62, aptitude: 0, core: 0, interview: 0, resume: 0 },
  weights: { dsa: 0.5, aptitude: 0.2, core: 0.15, interview: 0.1, resume: 0.05 },
};
const week = {
  target: 20,
  done: 14,
  left: 6,
  weekStart: '2026-10-25',
  weekEndsAt: '2026-10-31T23:59:59.999+05:30',
  expectedByNow: 14.1,
  status: 'on_track' as const,
};
export const PREP_VIEW = hub.PrepView.parse({
  tracks: [{ track: 'dsa', solved: 118, total: 190, percent: 62, topics }],
  untracked: [],
  dsa: { solved: 118, total: 190, percent: 62 },
  readiness,
  week,
  series: Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 30 + i)).toISOString().slice(0, 10),
    solved: 88 + i,
  })),
});

const slot = (n: number, date: string, from: string, to: string, status = 'open') => ({
  id: id(n),
  startsAt: at(date, from),
  endsAt: at(date, to),
  locationLabel: 'SPIT Main Gate',
  locationStopId: null,
  status,
});
const components = {
  match: 0.8,
  weakTopicCoverage: 0.8,
  interestOverlap: 0.6,
  availability: 0.5,
  load: 0.4,
};
const MENTORS = [
  [
    'Prof. Neha Iyer',
    'Computer Engg.',
    'Covers your two weakest topics: Dynamic Programming and Graphs.',
    ['DP', 'Graphs', 'System design'],
    0.92,
    2,
  ],
  [
    'Dr. Sameer Joshi',
    'IT',
    'Strong on Graphs; one free slot left.',
    ['Graphs', 'Greedy'],
    0.81,
    1,
  ],
  [
    'Prof. Kavita Nair',
    'Computer Engg.',
    'Covers Trees and DP; currently mentoring 5 students.',
    ['Trees', 'DP', 'OS'],
    0.77,
    3,
  ],
  ['Prof. Arjun Menon', 'EXTC', 'Overlaps on Greedy only.', ['Greedy', 'CN'], 0.64, 4],
] as const;
const NEHA_REQUEST = id(50);
const SESSION = slot(40, '2026-11-02', '15:30', '16:30', 'booked');
const mentorList = hub.MentorList.parse({
  items: MENTORS.map(([name, department, reason, expertise, score, slots], i) => ({
    rank: i + 1,
    mentorId: id(10 + i),
    name,
    department,
    expertise,
    capacity: 6,
    capacityLeft: 3,
    score,
    components,
    slotsThisWeek: slots,
    nextSlots: [],
    coveredTopics: [],
    reason,
    myRequest:
      i === 0
        ? {
            status: 'accepted',
            requestId: NEHA_REQUEST,
            startsAt: SESSION.startsAt,
            endsAt: SESSION.endsAt,
          }
        : { status: 'none' },
  })),
  nextCursor: null,
  weakTopics: [],
});

const student = (
  n: number,
  name: string,
  year: 'SE' | 'TE',
  branch: string,
  dsaPercent: number,
) => ({
  id: id(n),
  name,
  year,
  branch,
  dsaPercent,
  readiness: 30,
});
const neha = { id: id(10), name: 'Prof. Neha Iyer', department: 'Computer Engg.' };
const request = (
  n: number,
  status: 'pending' | 'accepted',
  note: string,
  createdAt: string,
  s: ReturnType<typeof student>,
) => ({
  id: id(n),
  status,
  note,
  createdAt,
  decidedAt: status === 'accepted' ? createdAt : null,
  slot: status === 'accepted' ? SESSION : null,
  mentor: neha,
  student: s,
  rideLink: null,
});
const incoming = hub.pages.requests.parse({
  items: [
    request(
      51,
      'pending',
      'Need help with interval DP before placements.',
      at('2026-10-29', '20:31'),
      student(20, 'Diya Kulkarni', 'TE', 'Computer Engineering', 54),
    ),
    request(
      52,
      'pending',
      'Would like a weekly check-in on graphs.',
      at('2026-10-27', '18:05'),
      student(21, 'Kabir Shah', 'SE', 'Information Technology', 31),
    ),
    request(
      50,
      'accepted',
      'DP and graphs, mock interview practice.',
      at('2026-10-26', '10:00'),
      student(1, 'Aarav Mehta', 'TE', 'Computer Engineering', 62),
    ),
  ],
  nextCursor: null,
});
const mine = hub.pages.requests.parse({ items: [incoming.items[2]], nextCursor: null });

const MB = 1024 * 1024;
const RESOURCES = [
  [
    'OS Unit 3 · Process scheduling notes',
    'OS',
    'Prof. Kavita Nair',
    2.4 * MB,
    '2026-10-28',
    'application/pdf',
  ],
  [
    'DBMS normalisation worked examples',
    'DBMS',
    'Diya Kulkarni',
    1.1 * MB,
    '2026-10-27',
    'application/pdf',
  ],
  ['CN subnetting cheat sheet', 'CN', 'Kabir Shah', 640 * 1024, '2026-10-25', 'image/png'],
  [
    'Graph algorithms, 40 problems',
    'DSA',
    'Prof. Neha Iyer',
    3.8 * MB,
    '2026-10-22',
    'application/pdf',
  ],
  [
    'OS previous year papers 2022–2025',
    'OS',
    'Admin Office',
    6.2 * MB,
    '2026-10-20',
    'application/pdf',
  ],
  ['Deadlock detection diagrams', 'OS', 'Ishita Rao', 880 * 1024, '2026-10-18', 'image/jpeg'],
] as const;
const resources = hub.pages.resources.parse({
  items: RESOURCES.map(([title, subject, by, size, date, mimeType], i) => ({
    id: id(60 + i),
    fileId: id(70 + i),
    title,
    description: null,
    subject,
    type: 'notes',
    semester: null,
    examYear: null,
    uploader: { id: id(80 + i), name: by },
    sizeBytes: Math.round(size),
    mimeType,
    createdAt: at(date, '12:00'),
    deletedAt: null,
    canDelete: false,
  })),
  nextCursor: null,
});
const subjects = ['OS', 'DBMS', 'CN', 'DSA'].map((code) => hub.Subject.parse({ code, name: code }));

const profile = (role: 'student' | 'mentor') =>
  hub.HubProfile.parse({
    user: USERS[role],
    branch: 'Computer Engineering',
    year: role === 'student' ? 'TE' : null,
    skills: [],
    interests: ['Graphs', 'Dynamic Programming', 'System design'],
    targetRole: null,
    targetCompanies: [],
    placementDeadline: null,
    isPeerMentor: false,
    isMentor: role === 'mentor',
    mentorExpertise: [],
    mentorDepartment: null,
    mentorCapacity: 0,
    readiness,
    updatedAt: null,
  });

const tab = (label: string) => async (page: Page) => {
  await page
    .locator('aside button', { hasText: /Student Hub/ })
    .first()
    .click();
  await page.getByRole('button', { name: label, exact: true }).click();
};
/** Undrawn additions inside the designed viewport (recorded for U3). */
const masks = ['a:has-text("Slots")', 'button:has-text("Mark completed")', '[data-undrawn]'];

const mod: U2Module = {
  screens: [
    { name: 'hub-prep', role: 'student', path: '/hub/prep', prototype: tab('Prep tracker') },
    { name: 'hub-mentors', role: 'student', path: '/hub/mentors', prototype: tab('Mentors') },
    { name: 'hub-resources', role: 'student', path: '/hub/resources', prototype: tab('Resources') },
    {
      name: 'hub-profile',
      role: 'student',
      path: '/hub/profile',
      prototype: tab('Profile'),
      masks,
    },
    {
      name: 'hub-requests',
      role: 'mentor',
      path: '/hub/requests',
      prototype: tab('Requests'),
      masks,
    },
  ],
  respond: (role, method, url) => {
    const p = url.pathname;
    if (!p.startsWith('/api/hub/')) return undefined;
    if (method === 'POST' && /^\/api\/hub\/prep\/[^/]+\/increment$/.test(p)) {
      const topic = PREP_VIEW.tracks[0]!.topics.find((t) => p.includes(`/${t.topicId}/`));
      if (!topic)
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: 'No such topic', requestId: 'req_mock' } },
        };
      return {
        body: hub.IncrementResponse.parse({
          topic: { ...topic, solved: topic.solved + 1 },
          dsa: { solved: 119, total: 190, percent: 63 },
          week: { ...week, done: 15, left: 5 },
        }),
      };
    }
    if (method !== 'GET') return undefined;
    if (p === '/api/hub/prep') return { body: PREP_VIEW };
    if (p === '/api/hub/mentors') return { body: mentorList };
    if (p === '/api/hub/requests/mine') return { body: mine };
    if (p === '/api/hub/requests/incoming') return { body: incoming };
    if (p === '/api/hub/resources') return { body: resources };
    if (p === '/api/hub/subjects') return { body: subjects };
    if (p === '/api/hub/me') return { body: profile(role === 'mentor' ? 'mentor' : 'student') };
    return undefined;
  },
};
export default mod;
