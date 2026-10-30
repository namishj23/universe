// Profiles: the caller's own profile, and the narrow student view mentors and admins get.
import { hub } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import type { PrepService } from './prep.js';
import { readiness } from './prep.js';
import {
  cardVisibleWhere,
  ensureProfile,
  errors,
  isMentor,
  isoOrNull,
  uniqueTags,
  type User,
} from './shared.js';

/** Drops undefined keys (exactOptionalPropertyTypes): omitted fields keep their value. */
const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

export function profileService(p: Platform, prep: PrepService) {
  const E = errors(p);

  async function get(user: User): Promise<hub.HubProfile> {
    const db = p.prisma;
    const [profile, progress] = await Promise.all([
      db.hubProfile.findUnique({ where: { userId: user.id } }),
      prep.progressOf(db, [user.id]),
    ]);
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      branch: profile?.branch ?? null,
      year: (profile?.year ?? null) as hub.HubProfile['year'],
      skills: profile?.skills ?? [],
      interests: profile?.interests ?? [],
      targetRole: profile?.targetRole ?? null,
      targetCompanies: profile?.targetCompanies ?? [],
      placementDeadline: profile?.placementDeadline
        ? profile.placementDeadline.toISOString().slice(0, 10)
        : null,
      isPeerMentor: profile?.isPeerMentor ?? false,
      isMentor: isMentor(user.role, profile),
      mentorExpertise: profile?.mentorExpertise ?? [],
      mentorDepartment: profile?.mentorDepartment ?? null,
      mentorCapacity: profile?.mentorCapacity ?? 3,
      readiness: readiness(progress(user.id)),
      updatedAt: isoOrNull(profile?.updatedAt),
    };
  }

  async function update(user: User, body: unknown) {
    const input = hub.UpdateProfileRequest.parse(body);
    if (input.isPeerMentor && user.role !== 'student')
      throw E.bad('Only students can be peer mentors; mentors are listed already.');
    const { placementDeadline, skills, interests, targetCompanies, mentorExpertise, ...rest } =
      input;
    const data = {
      ...defined(rest),
      ...(skills && { skills: uniqueTags(skills) }),
      ...(interests && { interests: uniqueTags(interests) }),
      ...(targetCompanies && { targetCompanies: uniqueTags(targetCompanies) }),
      ...(mentorExpertise && { mentorExpertise: uniqueTags(mentorExpertise) }),
      ...(placementDeadline !== undefined && {
        placementDeadline: placementDeadline ? new Date(`${placementDeadline}T00:00:00Z`) : null,
      }),
    };
    await p.transaction(async (tx) => {
      await ensureProfile(tx, user.id);
      const next = await tx.hubProfile.update({ where: { userId: user.id }, data });
      if (next.isPeerMentor && next.mentorExpertise.length === 0)
        throw E.bad('A peer mentor needs at least one expertise tag.');
    });
    return get(user);
  }

  /**
   * A student's card: admins always; a mentor (a peer mentor only while still mentoring) only
   * through a request that is pending or accepted, or completed within 14 days (P7-006);
   * anyone else (and any non-student id) gets 404.
   */
  async function student(viewer: User, params: unknown): Promise<hub.StudentCard> {
    const { id } = hub.HubIdParam.parse(params);
    const db = p.prisma;
    const target = await db.user.findUnique({ where: { id }, select: { role: true } });
    if (!target || target.role !== 'student') throw E.notFound();
    if (viewer.role !== 'admin') {
      const [asked, profile] = await Promise.all([
        db.hubMentorshipRequest.findFirst({
          where: { studentId: id, mentorId: viewer.id, ...cardVisibleWhere() },
          select: { id: true },
        }),
        db.hubProfile.findUnique({ where: { userId: viewer.id } }),
      ]);
      if (!asked || !isMentor(viewer.role, profile)) throw E.notFound();
    }
    const card = (await prep.studentCards(db, [id])).get(id);
    if (!card) throw E.notFound();
    return card;
  }

  return { get, update, student };
}
