/**
 * The prototype's sample data (UniVerse App.dc.html: ROLES, INBOX, USERS, AUDIT, the week strip)
 * in the exact response shapes of docs/api/openapi.json. Every fixture is parsed with the
 * contracts' Zod schemas when this file loads, so a fixture that drifts from the API fails.
 *
 * Where the API has no field for something the prototype shows (module summaries that are
 * `not_built`, observatory/exam activity types, audit target names), the fixture holds what the
 * real API would return and the difference is listed in docs/sessions/U1-compare/README.md.
 */
import { z } from 'zod';
import {
  ActivityEvent,
  AdminUser,
  AuditEntry,
  CreateUserResponse,
  DashboardResponse,
  ModuleInfo,
  pageOf,
  SessionResponse,
  WeekResponse,
  type ActivityModule,
  type PublicUser,
  type WeekItem,
} from '../../../packages/contracts/src/index.ts';

export type DemoRole = 'student' | 'mentor' | 'invigilator' | 'admin';
export const ROLES: DemoRole[] = ['student', 'mentor', 'invigilator', 'admin'];

/** The prototype's moment: its login screen reads THU 29 OCT 2026 · 22:14 IST. */
export const NOW = new Date('2026-10-29T22:14:00+05:30');
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const USERS: Record<DemoRole, PublicUser> = {
  student: { id: id(1), email: 'student@universe.test', name: 'Aarav Mehta', role: 'student' },
  mentor: { id: id(3), email: 'mentor@universe.test', name: 'Prof. Neha Iyer', role: 'mentor' },
  invigilator: {
    id: id(4),
    email: 'invigilator@universe.test',
    name: 'Rohan Desai',
    role: 'invigilator',
  },
  admin: { id: id(5), email: 'admin@universe.test', name: 'Admin Office', role: 'admin' },
};
const actor = (role: DemoRole) => ({ id: USERS[role].id, name: USERS[role].name });
const person = (n: number, name: string) => ({ id: id(n), name });

export const session = (role: DemoRole, mustChangePassword = false) =>
  SessionResponse.parse({ user: USERS[role], csrfToken: 'csrf-fixture', mustChangePassword });

const MODULE_INFO: Record<string, z.input<typeof ModuleInfo>> = {
  hub: { id: 'hub', label: 'Student Hub', order: 10, basePath: '/api/hub' },
  rides: { id: 'rides', label: 'Rides', order: 20, basePath: '/api/rides' },
  observatory: { id: 'observatory', label: 'Observatory', order: 25, basePath: '/api/observatory' },
  wellbeing: { id: 'wellbeing', label: 'Wellbeing', order: 30, basePath: '/api/wellbeing' },
  exam: { id: 'exam', label: 'Exam Review', order: 50, basePath: '/api/exam' },
};
/** Exactly the prototype's sidebar per role (ROLES[role].nav, minus the shell's own Admin). */
const NAV: Record<DemoRole, string[]> = {
  student: ['hub', 'rides', 'observatory', 'wellbeing'],
  mentor: ['hub', 'rides', 'observatory', 'wellbeing'],
  invigilator: ['observatory', 'exam'],
  admin: ['hub', 'rides', 'observatory', 'exam'],
};
export const modules = (role: DemoRole) =>
  z.array(ModuleInfo).parse(NAV[role].map((m) => MODULE_INFO[m]));

// ---- Activity (INBOX) -------------------------------------------------------------------
type Ev = z.input<typeof ActivityEvent>;
let evId = 100;
const ev = (
  module: ActivityModule,
  type: string,
  payload: unknown,
  who: { id: string; name: string } | null,
  createdAt: string,
  unread: boolean,
): Ev => ({
  id: id(evId++),
  module,
  type,
  payload,
  actor: who,
  readAt: unread ? null : createdAt,
  createdAt,
});
const announce = (message: string) => ({ message });
const offer = (departAt: string, origin: string) => ({
  offerId: id(900),
  originName: origin,
  destinationName: 'SPIT Gate',
  departAt,
});
const diya = person(2, 'Diya Kulkarni');
const kabir = person(6, 'Kabir Shah');
const TODAY = '2026-10-29';
const LIBRARY = announce('Library open until 23:00 through exam week.');

// Modules without activity contracts yet (hub, wellbeing, exam, observatory) use provisional
// types with a `message`; the inbox's generic wording shows the message.
const INBOX: Record<DemoRole, Ev[]> = {
  student: [
    ev('platform', 'platform.announcement', LIBRARY, actor('admin'), at(TODAY, '22:02'), true),
    ev(
      'rides',
      'rides.seat_accepted',
      offer('2026-10-30T08:10:00+05:30', 'Kandivali'),
      diya,
      at(TODAY, '19:40'),
      true,
    ),
    ev(
      'hub',
      'hub.mentorship_accepted',
      announce('accepted your mentorship request for Mon 15:30.'),
      actor('mentor'),
      at(TODAY, '17:15'),
      true,
    ),
    ev(
      'wellbeing',
      'wellbeing.weekly_summary',
      announce('Your weekly summary is ready. Only you can see it.'),
      null,
      at('2026-10-28', '09:00'),
      false,
    ),
    ev(
      'platform',
      'platform.announcement',
      announce('Welcome to UniVerse.'),
      null,
      at('2026-10-28', '08:00'),
      false,
    ),
  ],
  mentor: [
    ev('platform', 'platform.announcement', LIBRARY, actor('admin'), at(TODAY, '22:02'), true),
    ev(
      'hub',
      'hub.mentorship_requested',
      announce('requested mentorship: interval DP.'),
      diya,
      at(TODAY, '20:31'),
      true,
    ),
    ev(
      'rides',
      'rides.seat_requested',
      { ...offer('2026-10-30T08:30:00+05:30', 'Malad'), passengerFirstName: 'Kabir' },
      kabir,
      at(TODAY, '18:05'),
      false,
    ),
    ev(
      'platform',
      'platform.announcement',
      announce('Welcome to UniVerse.'),
      null,
      at('2026-10-28', '08:00'),
      false,
    ),
  ],
  invigilator: [
    ev('platform', 'platform.announcement', LIBRARY, actor('admin'), at(TODAY, '22:02'), true),
    ev(
      'exam',
      'exam.flags_raised',
      announce('5 new flags from OS Midterm · Hall B need review.'),
      null,
      at(TODAY, '11:30'),
      true,
    ),
    ev(
      'observatory',
      'observatory.maintenance',
      announce('Lab cluster maintenance on Wed 04 at 02:00.'),
      null,
      at('2026-10-27', '10:00'),
      false,
    ),
  ],
  admin: [
    ev('platform', 'platform.announcement', LIBRARY, actor('admin'), at(TODAY, '22:02'), false),
    ev(
      'exam',
      'exam.flag_reviewed',
      announce('dismissed flag F-1039 with a note.'),
      actor('invigilator'),
      at(TODAY, '21:40'),
      true,
    ),
    ev(
      'platform',
      'platform.accounts_created',
      announce('3 new accounts created this week.'),
      null,
      at('2026-10-26', '09:00'),
      false,
    ),
  ],
};
const FeedPage = pageOf(ActivityEvent);
export const feed = (role: DemoRole, empty = false) =>
  FeedPage.parse({ items: empty ? [] : INBOX[role], nextCursor: null });
export const unread = (role: DemoRole) => INBOX[role].filter((e) => e.readAt === null).length;

// ---- Dashboard ----------------------------------------------------------------------------
const RIDER = {
  kind: 'rider',
  upcomingRide: {
    rideType: 'carpool',
    id: id(900),
    pickupName: 'Borivali Stn',
    dropName: 'SPIT Gate',
    pickupTime: '2026-10-30T02:40:00.000Z',
    groupSize: 3,
  },
  ridesCompleted: 6,
  sharedDistanceM: 41_200,
  savedPaise: 64_300,
  carpool: null,
};
const SUMMARY: Record<string, unknown> = {
  hub: { status: 'not_built' },
  rides: RIDER,
  wellbeing: { status: 'not_built' },
};
export const dashboard = (role: DemoRole, empty = false) =>
  DashboardResponse.parse({
    user: USERS[role],
    unreadCount: unread(role),
    latest: INBOX[role].slice(0, 5),
    // Observatory and exam have no summary contract yet: the real API lists only modules
    // that have one, so they get the shell's placeholder card.
    modules: empty
      ? []
      : NAV[role]
          .filter((m) => m in SUMMARY)
          .map((m) => ({ id: m, status: 'ok', data: SUMMARY[m] })),
  });

// ---- Week strip -------------------------------------------------------------------------
const DATES = [
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
];
type It = WeekItem;
const it = (
  module: It['module'],
  time: string | null,
  title: string,
  status?: [string, 'ok' | 'warn' | 'neutral'],
  confirmed = true,
): It => ({
  module,
  ...(time ? { time } : { allDay: true as const }),
  title,
  ...(status && { status: { label: status[0], tone: status[1] } }),
  confirmed,
  href: `/${module}`,
});
const LAB = it('observatory', '02:00', 'Lab cluster maintenance');
// The prototype's W table. Its "now"/"today" labels have no field in the contract: all day.
const WEEK: Record<DemoRole, It[][]> = {
  student: [
    [it('wellbeing', '20:00', 'Tracking paused')],
    [
      it('rides', '08:10', 'Ride to SPIT', ['confirmed', 'ok']),
      it('rides', '17:30', 'Return ride', ['searching', 'warn'], false),
    ],
    [it('hub', null, 'Prep goal ends, 6 left')],
    [it('wellbeing', '09:00', 'Weekly summary')],
    [it('hub', '15:30', 'Mentor session, Prof. Neha Iyer', ['accepted', 'ok'])],
    [],
    [LAB],
  ],
  mentor: [
    [it('hub', null, '2 mentorship requests', ['waiting', 'warn'])],
    [it('rides', '08:30', 'Driving from Malad', ['1 of 3 seats', 'ok'])],
    [],
    [it('wellbeing', '09:00', 'Weekly summary')],
    [it('hub', '15:30', 'Session with Aarav Mehta', ['confirmed', 'ok'])],
    [it('hub', '11:00', 'Session with Diya Kulkarni', ['tentative', 'warn'], false)],
    [LAB],
  ],
  invigilator: [
    [it('exam', null, '5 flags open · OS Midterm', ['needs review', 'warn'])],
    [it('exam', '10:00', 'DBMS Internal · Hall B', ['scheduled', 'neutral'])],
    [],
    [],
    [it('exam', '14:00', 'CN Quiz · Lab 204', ['scheduled', 'neutral'])],
    [],
    [LAB],
  ],
  // The prototype's "§ · 10:00 Weekly audit review" is not a module: no item can carry it.
  admin: [
    [it('exam', null, '5 exam flags open')],
    [it('exam', '10:00', 'DBMS Internal · Hall B', ['scheduled', 'neutral'])],
    [],
    [],
    [],
    [],
    [LAB],
  ],
};
export const week = (role: DemoRole, empty = false) =>
  WeekResponse.parse({
    from: DATES[0],
    timeZone: 'Asia/Kolkata',
    days: DATES.map((date, i) => ({ date, items: empty ? [] : (WEEK[role][i] ?? []) })),
    modules: [],
  });

// ---- Admin --------------------------------------------------------------------------------
const user = (
  n: number,
  name: string,
  email: string,
  role: PublicUser['role'],
  lastLoginAt: string | null,
  isActive = true,
) => ({
  id: id(n),
  name,
  email,
  role,
  isActive,
  mustChangePassword: false,
  lastLoginAt,
  createdAt: at('2026-09-01', '10:00'),
});
const ADMIN_USERS = [
  user(1, 'Aarav Mehta', 'student@universe.test', 'student', at(TODAY, '22:10')),
  user(2, 'Diya Kulkarni', 'student2@universe.test', 'student', at(TODAY, '19:41')),
  user(3, 'Prof. Neha Iyer', 'mentor@universe.test', 'mentor', at(TODAY, '20:02')),
  user(4, 'Rohan Desai', 'invigilator@universe.test', 'invigilator', at(TODAY, '21:40')),
  user(5, 'Admin Office', 'admin@universe.test', 'admin', at(TODAY, '22:14')),
  user(6, 'Kabir Shah', 'kabir.shah@spit.ac.in', 'student', at(TODAY, '18:05')),
  user(7, 'Ishita Rao', 'ishita.rao@spit.ac.in', 'student', at('2026-10-12', '10:00'), false),
];
export const users = (empty = false) =>
  pageOf(AdminUser).parse({ items: empty ? [] : ADMIN_USERS, nextCursor: null });

const req = (prefix: string) => `${prefix}00-0000-4000-8000-000000000000`;
const entry = (
  time: string,
  who: { id: string; name: string } | null,
  action: string,
  target: [string, string] | null,
  metadata: unknown,
  requestId: string,
) => ({
  id: id(evId++),
  actor: who,
  action,
  targetType: target?.[0] ?? null,
  targetId: target?.[1] ?? null,
  metadata,
  requestId,
  createdAt: at(TODAY, time),
});
// Real action names: the prototype's admin.password_reset / admin.user_deactivated are
// admin.user_password_reset / admin.user_updated in contracts/src/audit/platform.ts.
const AUDIT = [
  entry('22:14', actor('admin'), 'auth.login', ['user', id(5)], {}, req('7f3c2a')),
  entry(
    '22:02',
    actor('admin'),
    'platform.announcement_sent',
    null,
    { recipients: 5 },
    req('6b91de'),
  ),
  entry(
    '21:40',
    actor('invigilator'),
    'exam.flag_reviewed',
    ['exam_flag', 'F-1039'],
    {},
    req('5a20c4'),
  ),
  entry(
    '21:12',
    null,
    'auth.login_failed',
    null,
    { emailHmac: `3f9a${'0'.repeat(60)}` },
    req('49e7b0'),
  ),
  entry(
    '20:55',
    actor('admin'),
    'admin.user_created',
    ['user', id(6)],
    { role: 'student' },
    req('38d1f2'),
  ),
  entry('20:31', actor('admin'), 'admin.user_password_reset', ['user', id(7)], {}, req('27c6a9')),
  entry('19:58', actor('mentor'), 'auth.password_changed', ['user', id(3)], {}, req('16b5e1')),
  entry(
    '19:02',
    actor('admin'),
    'admin.user_updated',
    ['user', id(7)],
    { isActive: { from: true, to: false } },
    req('05a4d8'),
  ),
];
export const audit = (empty = false) =>
  pageOf(AuditEntry).parse({ items: empty ? [] : AUDIT, nextCursor: null });

/** The request ID the prototype's error box shows. */
/** POST /api/admin/users: the prototype's temporary password. */
export const created = CreateUserResponse.parse({
  user: { ...ADMIN_USERS[5], id: id(8), name: 'Meera Pillai', email: 'meera.pillai@spit.ac.in' },
  temporaryPassword: 'q7Vd-2mKx_9TfL4w-Rb8sNe',
});

export const ERROR_REQUEST_ID = '7f3c2a91-0e4b-4d1a-9c55-b2a1e0d8f6c3';
