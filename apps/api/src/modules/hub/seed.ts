// Hub demo data (idempotent; times relative to now). Matches the design's sample data where it
// is consistent: Aarav's DSA sheet 118/190 with 14 of 20 done this week, four mentors, Neha's
// three requests, Kavita's five mentees and the six shared resources.
import { istDate, istDateStart, weekOf } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { jpeg, pdf, png } from './seedFiles.js';
import { ensureProfile } from './shared.js';

export const TOPICS = [
  {
    id: 'dsa-arrays',
    track: 'dsa',
    name: 'Arrays & Strings',
    tag: 'Arrays',
    totalItems: 50,
    sort: 1,
  },
  {
    id: 'dsa-linked-lists',
    track: 'dsa',
    name: 'Linked Lists',
    tag: 'Linked lists',
    totalItems: 20,
    sort: 2,
  },
  { id: 'dsa-trees', track: 'dsa', name: 'Trees', tag: 'Trees', totalItems: 30, sort: 3 },
  { id: 'dsa-graphs', track: 'dsa', name: 'Graphs', tag: 'Graphs', totalItems: 30, sort: 4 },
  { id: 'dsa-dp', track: 'dsa', name: 'Dynamic Programming', tag: 'DP', totalItems: 35, sort: 5 },
  { id: 'dsa-greedy', track: 'dsa', name: 'Greedy', tag: 'Greedy', totalItems: 25, sort: 6 },
  {
    id: 'apt-quant',
    track: 'aptitude',
    name: 'Quantitative aptitude',
    tag: 'Quant',
    totalItems: 30,
    sort: 7,
  },
  {
    id: 'apt-logical',
    track: 'aptitude',
    name: 'Logical reasoning',
    tag: 'Logical',
    totalItems: 20,
    sort: 8,
  },
  { id: 'core-os', track: 'core', name: 'Operating Systems', tag: 'OS', totalItems: 20, sort: 9 },
  {
    id: 'core-dbms',
    track: 'core',
    name: 'Database Management Systems',
    tag: 'DBMS',
    totalItems: 20,
    sort: 10,
  },
  { id: 'core-cn', track: 'core', name: 'Computer Networks', tag: 'CN', totalItems: 20, sort: 11 },
  {
    id: 'int-mock',
    track: 'interview',
    name: 'Mock interviews',
    tag: 'Mock interview',
    totalItems: 5,
    sort: 12,
  },
  {
    id: 'res-review',
    track: 'resume',
    name: 'Resume review',
    tag: 'Resume',
    totalItems: 1,
    sort: 13,
  },
] as const;

export const SUBJECTS = [
  { code: 'OS', name: 'Operating Systems', sort: 1 },
  { code: 'DBMS', name: 'Database Management Systems', sort: 2 },
  { code: 'CN', name: 'Computer Networks', sort: 3 },
  { code: 'DSA', name: 'Data Structures and Algorithms', sort: 4 },
  { code: 'OOP', name: 'Object-Oriented Programming', sort: 5 },
  { code: 'MATHS', name: 'Engineering Mathematics', sort: 6 },
  { code: 'OTHER', name: 'Other', sort: 7 },
] as const;

const DAY = 86_400_000;
const DSA = ['dsa-arrays', 'dsa-linked-lists', 'dsa-trees', 'dsa-graphs', 'dsa-dp', 'dsa-greedy'];

interface StudentSeed {
  email: string;
  profile: Record<string, unknown>;
  solved: Record<string, number>;
  thisWeek?: number;
}

const STUDENTS: StudentSeed[] = [
  {
    email: 'student@universe.test', // Aarav Mehta
    profile: {
      year: 'TE',
      branch: 'Computer Engineering',
      skills: ['C++', 'Python', 'SQL'],
      interests: ['Graphs', 'Dynamic Programming', 'System design'],
      targetRole: 'SDE intern',
      targetCompanies: ['Google', 'Microsoft'],
    },
    solved: zip(DSA, [44, 18, 21, 16, 11, 8]),
    thisWeek: 14,
  },
  {
    email: 'student2@universe.test', // Diya Kulkarni
    profile: {
      year: 'TE',
      branch: 'Computer Engineering',
      skills: ['Java', 'SQL'],
      interests: ['DBMS', 'Dynamic Programming'],
      targetRole: 'Data analyst intern',
      targetCompanies: ['Deloitte'],
    },
    solved: zip(DSA, [40, 15, 18, 12, 10, 8]),
  },
  {
    email: 'kabir.shah@universe.test',
    profile: {
      year: 'SE',
      branch: 'Information Technology',
      skills: ['Python'],
      interests: ['Graphs', 'Computer Networks'],
      targetRole: 'Backend intern',
    },
    solved: zip(DSA, [25, 10, 9, 6, 5, 4]),
  },
  {
    email: 'ishita.rao@universe.test',
    profile: {
      year: 'BE',
      branch: 'Computer Engineering',
      interests: ['Operating Systems', 'Trees'],
    },
    solved: { ...zip(DSA, [46, 19, 24, 20, 22, 18]), 'core-os': 14 },
  },
  {
    email: 'sneha.patil@universe.test',
    profile: {
      year: 'TE',
      branch: 'Electronics and Telecommunication',
      interests: ['Trees', 'Greedy'],
    },
    solved: zip(DSA, [30, 12, 10, 8, 6, 9]),
  },
  {
    email: 'rahul.verma@universe.test',
    profile: { year: 'SE', branch: 'Information Technology', interests: ['Dynamic Programming'] },
    solved: zip(DSA, [20, 8, 6, 4, 3, 5]),
  },
];

const MENTORS = [
  {
    email: 'mentor@universe.test',
    department: 'Computer Engg.',
    expertise: ['DP', 'Graphs', 'System design'],
    capacity: 3,
  },
  {
    email: 'sameer.joshi@universe.test',
    department: 'IT',
    expertise: ['Graphs', 'Greedy'],
    capacity: 3,
  },
  {
    email: 'kavita.nair@universe.test',
    department: 'Computer Engg.',
    expertise: ['Trees', 'DP', 'OS'],
    capacity: 8,
  },
  {
    email: 'arjun.menon@universe.test',
    department: 'EXTC',
    expertise: ['Greedy', 'CN'],
    capacity: 3,
  },
];

/** Open slots: [days from today, IST time]. Every one lies in the next 7 days. */
const OPEN_SLOTS: Record<string, [number, string][]> = {
  'mentor@universe.test': [
    [1, '11:00'],
    [2, '17:00'],
  ],
  'sameer.joshi@universe.test': [[3, '12:00']],
  'kavita.nair@universe.test': [
    [1, '10:00'],
    [2, '14:00'],
    [4, '10:00'],
  ],
  'arjun.menon@universe.test': [
    [1, '09:00'],
    [2, '09:00'],
    [3, '09:00'],
    [5, '09:00'],
  ],
};

const KAVITA_MENTEES = [
  'student2@universe.test',
  'kabir.shah@universe.test',
  'ishita.rao@universe.test',
  'sneha.patil@universe.test',
  'rahul.verma@universe.test',
];

const KB = 1024;
const MB = 1024 * 1024;
const RESOURCES = [
  {
    title: 'OS Unit 3 · Process scheduling notes',
    subject: 'OS',
    by: 'kavita.nair@universe.test',
    bytes: Math.round(2.4 * MB),
    daysAgo: 1,
    kind: 'pdf',
    type: 'notes',
    semester: 5,
    description: 'FCFS, SJF, round robin and priority scheduling with worked Gantt charts.',
  },
  {
    title: 'DBMS normalisation worked examples',
    subject: 'DBMS',
    by: 'student2@universe.test',
    bytes: Math.round(1.1 * MB),
    daysAgo: 2,
    kind: 'pdf',
    type: 'study_material',
    semester: 4,
    description: '1NF to BCNF on six exam-style schemas.',
  },
  {
    title: 'CN subnetting cheat sheet',
    subject: 'CN',
    by: 'kabir.shah@universe.test',
    bytes: 640 * KB,
    daysAgo: 4,
    kind: 'png',
    type: 'cheat_sheet',
    semester: 5,
    description: 'CIDR blocks, masks and host counts on one page.',
  },
  {
    title: 'Graph algorithms, 40 problems',
    subject: 'DSA',
    by: 'mentor@universe.test',
    bytes: Math.round(3.8 * MB),
    daysAgo: 7,
    kind: 'pdf',
    type: 'study_material',
    description: 'BFS, DFS, shortest paths and MST practice set with hints.',
  },
  {
    title: 'OS previous year papers 2022–2025',
    subject: 'OS',
    by: 'admin@universe.test',
    bytes: Math.round(6.2 * MB),
    daysAgo: 9,
    kind: 'pdf',
    type: 'question_paper',
    semester: 5,
    examYear: 2025,
    description: 'End-semester papers, four years.',
  },
  {
    title: 'Deadlock detection diagrams',
    subject: 'OS',
    by: 'ishita.rao@universe.test',
    bytes: 880 * KB,
    daysAgo: 11,
    kind: 'jpeg',
    type: 'notes',
    semester: 5,
    description: 'Resource allocation graphs and the banker’s algorithm, drawn out.',
  },
] as const;

function zip(keys: readonly string[], values: readonly number[]) {
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? 0]));
}

/** `days` from today (IST) at `hhmm` IST. */
const istAt = (now: Date, days: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(
    istDateStart(istDate(new Date(now.getTime() + days * DAY))).getTime() + (h * 60 + m) * 60_000,
  );
};

/** The next Monday after today (IST), 1–7 days ahead. */
const nextMonday = (now: Date) => {
  for (let d = 1; d <= 7; d += 1) {
    const day = istDateStart(istDate(new Date(now.getTime() + d * DAY)));
    if (new Date(day.getTime() + 330 * 60_000).getUTCDay() === 1) return d;
  }
  return 7;
};

export async function seedHub(p: Platform): Promise<void> {
  const db = p.prisma;
  const now = new Date();
  for (const t of TOPICS) await db.hubTopic.upsert({ where: { id: t.id }, create: t, update: t });
  for (const s of SUBJECTS)
    await db.hubSubject.upsert({ where: { code: s.code }, create: s, update: s });

  const emails = [
    ...STUDENTS.map((s) => s.email),
    ...MENTORS.map((m) => m.email),
    ...RESOURCES.map((r) => r.by),
  ];
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const idOf = new Map(users.map((u) => [u.email, u.id]));
  const id = (email: string) => {
    const found = idOf.get(email);
    if (!found)
      throw new Error(`hub seed: account ${email} is missing (run the platform seed first)`);
    return found;
  };

  // Profiles and placement goals.
  for (const s of STUDENTS) {
    const userId = id(s.email);
    const data = {
      ...s.profile,
      placementDeadline:
        s.email === 'student@universe.test'
          ? new Date(`${istDate(new Date(now.getTime() + 42 * DAY))}T00:00:00Z`)
          : null,
    };
    await db.hubProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  }
  for (const m of MENTORS) {
    const userId = id(m.email);
    const data = {
      mentorDepartment: m.department,
      mentorExpertise: m.expertise,
      mentorCapacity: m.capacity,
    };
    await db.hubProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  }

  // Tracked topics with a history of changes (only for a student with none yet).
  const week = weekOf(now);
  for (const s of STUDENTS) {
    const userId = id(s.email);
    if ((await db.hubTopicProgress.count({ where: { userId } })) > 0) continue;
    const trackedSince = new Date(now.getTime() - 40 * DAY);
    const totals = new Map<string, number>(TOPICS.map((t) => [t.id, t.totalItems]));
    const topicIds = Object.keys(s.solved);
    await db.hubTopicProgress.createMany({
      data: topicIds.map((topicId) => ({
        userId,
        topicId,
        totalItems: totals.get(topicId) ?? 1,
        solved: s.solved[topicId] ?? 0,
        trackedSince,
      })),
    });
    // This week's +1s round-robin over the weakest-first topics, the rest in chunks of up to 3
    // spread over the 32 days before the week began.
    const events: { userId: string; topicId: string; delta: number; createdAt: Date }[] = [];
    const left = new Map(topicIds.map((t) => [t, s.solved[t] ?? 0]));
    const thisWeek = s.thisWeek ?? 0;
    const order = [...topicIds].reverse();
    const span = now.getTime() - week.start.getTime();
    for (let i = 0; i < thisWeek; i += 1) {
      const topicId = order[i % order.length] ?? order[0]!;
      if ((left.get(topicId) ?? 0) === 0) continue;
      left.set(topicId, (left.get(topicId) ?? 0) - 1);
      events.push({
        userId,
        topicId,
        delta: 1,
        createdAt: new Date(week.start.getTime() + ((i + 1) * span) / (thisWeek + 1)),
      });
    }
    const earlyEnd = (thisWeek > 0 ? week.start.getTime() : now.getTime()) - 3_600_000;
    const earlyStart = now.getTime() - 32 * DAY;
    const chunks: { topicId: string; delta: number }[] = [];
    for (const [topicId, n] of left)
      for (let k = n; k > 0; k -= 3) chunks.push({ topicId, delta: Math.min(3, k) });
    chunks.forEach((c, i) =>
      events.push({
        userId,
        ...c,
        createdAt: new Date(earlyStart + ((i + 1) * (earlyEnd - earlyStart)) / (chunks.length + 1)),
      }),
    );
    await db.hubProgressEvent.createMany({ data: events });
    if (thisWeek > 0)
      await db.hubWeeklyGoal.upsert({
        where: { userId_weekStart: { userId, weekStart: new Date(`${week.startDate}T00:00:00Z`) } },
        create: { userId, weekStart: new Date(`${week.startDate}T00:00:00Z`), target: 20 },
        update: {},
      });
  }

  // Slots and requests (only for a mentor with no slots yet).
  const slot = (
    mentorId: string,
    start: Date,
    status: 'open' | 'booked',
    label: string,
    locationStopId: string | null = null,
  ) =>
    db.hubMentorSlot.create({
      data: {
        mentorId,
        startsAt: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        status,
        locationLabel: label,
        locationStopId,
      },
    });
  // Aarav's Monday session is at a campus stop a car can reach, so it gets a ride link (P6).
  // Rides seeds first (`seedAfter`); without the rides module the slot has no stop.
  const campusStop = async (actorId: string) =>
    (
      await p.modules
        .get('rides')
        ?.searchStops({ actor: { id: actorId, role: 'mentor' }, q: 'SPIT Main Gate' })
    )?.find((x) => x.name === 'SPIT Main Gate' && x.drivable)?.id ?? null;
  for (const m of MENTORS) {
    const mentorId = id(m.email);
    if ((await db.hubMentorSlot.count({ where: { mentorId } })) > 0) continue;
    const room =
      m.department === 'EXTC'
        ? 'EXTC staff room'
        : m.department === 'IT'
          ? 'IT lab 2'
          : 'Room 304, Computer dept';
    const open = [];
    for (const [days, at] of OPEN_SLOTS[m.email] ?? [])
      open.push(await slot(mentorId, istAt(now, days, at), 'open', room));

    if (m.email === 'mentor@universe.test') {
      const aarav = id('student@universe.test');
      const diya = id('student2@universe.test');
      const kabir = id('kabir.shah@universe.test');
      const monday = await slot(
        mentorId,
        istAt(now, nextMonday(now), '15:30'),
        'booked',
        'Room 304, Computer dept (SPIT Main Gate)',
        await campusStop(mentorId),
      );
      for (const s of [aarav, diya, kabir]) await ensureProfile(db, s);
      // Diya's pending request names Neha's first open slot (the mentor's "tentative" item).
      const requests = [
        {
          studentId: diya,
          name: 'Diya Kulkarni',
          slotId: open[0]?.id ?? null,
          note: 'Need help with interval DP before placements.',
          createdAt: new Date(now.getTime() - 5 * 3_600_000),
        },
        {
          studentId: kabir,
          name: 'Kabir Shah',
          slotId: null,
          note: 'Would like a weekly check-in on graphs.',
          createdAt: new Date(now.getTime() - 3 * DAY),
        },
      ];
      // The inbox events these requests would have sent (the story seed dates them).
      for (const { name, ...r } of requests) {
        const created = await db.hubMentorshipRequest.create({ data: { ...r, mentorId } });
        const slotStart = open.find((o) => o.id === r.slotId)?.startsAt;
        await p.emit({
          recipients: mentorId,
          actorId: r.studentId,
          module: 'hub',
          type: 'hub.request_received',
          payload: {
            requestId: created.id,
            studentName: name,
            note: r.note,
            startsAt: slotStart ? slotStart.toISOString() : null,
          },
        });
      }
      const accepted = await db.hubMentorshipRequest.create({
        data: {
          studentId: aarav,
          mentorId,
          slotId: monday.id,
          status: 'accepted',
          note: 'DP and graphs, mock interview practice.',
          createdAt: new Date(now.getTime() - 2 * DAY),
          decidedAt: new Date(now.getTime() - 4 * 3_600_000),
        },
      });
      await p.emit({
        recipients: aarav,
        actorId: mentorId,
        module: 'hub',
        type: 'hub.request_accepted',
        payload: {
          requestId: accepted.id,
          mentorName: 'Prof. Neha Iyer',
          startsAt: monday.startsAt.toISOString(),
          endsAt: monday.endsAt.toISOString(),
          locationLabel: monday.locationLabel,
        },
      });
    }
    if (m.email === 'kavita.nair@universe.test') {
      const days = [1, 2, 3, 5, 6];
      for (const [i, email] of KAVITA_MENTEES.entries()) {
        const booked = await slot(mentorId, istAt(now, days[i] ?? 6, '16:00'), 'booked', room);
        await db.hubMentorshipRequest.create({
          data: {
            studentId: id(email),
            mentorId,
            slotId: booked.id,
            status: 'accepted',
            note: null,
            createdAt: new Date(now.getTime() - (10 + i) * DAY),
            decidedAt: new Date(now.getTime() - (9 + i) * DAY),
          },
        });
      }
    }
  }

  // The shared repository: real files through platform storage.
  for (const r of RESOURCES) {
    const uploaderId = id(r.by);
    if (await db.hubResource.findFirst({ where: { title: r.title, uploaderId } })) continue;
    const [bytes, mimeType, ext] =
      r.kind === 'pdf'
        ? [pdf(r.title, r.bytes), 'application/pdf', 'pdf']
        : r.kind === 'png'
          ? [png(r.bytes), 'image/png', 'png']
          : [jpeg(r.bytes), 'image/jpeg', 'jpg'];
    const file = await p.files.save({
      ownerId: uploaderId,
      module: 'hub',
      purpose: 'hub.resource',
      originalName: `${r.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.${ext}`,
      mimeType,
      bytes,
    });
    await ensureProfile(db, uploaderId);
    await db.hubResource.create({
      data: {
        fileId: file.id,
        title: r.title,
        description: r.description,
        subject: r.subject,
        type: r.type,
        semester: 'semester' in r ? r.semester : null,
        examYear: 'examYear' in r ? r.examYear : null,
        uploaderId,
        createdAt: new Date(now.getTime() - r.daysAgo * DAY - 3_600_000),
      },
    });
  }
}
