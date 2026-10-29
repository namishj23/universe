// Module D · Privacy-Aware Digital Wellbeing (Person 1). Personal data: only the owner sees it
// (students and mentors; admins never). Raw browsing data stays in the browser
// (`@universe/wellbeing-core`); the server keeps daily category totals and settings only.
import { weekOf, type WeekProviderItem } from '@universe/contracts';
import type { ModuleFactory, PublicApiImpl } from '../../platform/modules/index.js';
import { JOB_EVERY_MS, JOB_NAME, runOnce } from './jobs.js';
import { routes } from './routes.js';
import { seedWellbeing } from './seed.js';
import { wellbeingService } from './service.js';

const SUMMARY_AT_MS = 9 * 3_600_000; // Sunday 09:00 Asia/Kolkata, as the job sends it

const wellbeing: ModuleFactory = (platform) => {
  const service = wellbeingService(platform);
  // The one value other modules may ask for; the service returns null unless the actor asks
  // about themselves and shares it.
  const publicApi: PublicApiImpl<'wellbeing'> = {
    studyMinutesThisWeek: ({ actor, userId }) =>
      service.studyMinutesThisWeek({ actorId: actor.id, userId }),
  };
  // The owner's own week strip: when tracking was paused, and the next weekly summary.
  const weekItems = async (user: { id: string }, range: { from: Date; to: Date }) => {
    const s = await platform.prisma.wbSettings.findUnique({ where: { userId: user.id } });
    if (!s || s.tracking === 'off') return [];
    const items: WeekProviderItem[] = [];
    if (s.tracking === 'paused' && s.pausedSince)
      items.push({
        at: s.pausedSince.toISOString(),
        title: 'Tracking paused',
        confirmed: true,
        href: '/wellbeing',
      });
    const week = weekOf(range.from);
    for (const sunday of [week.start, week.end]) {
      const at = new Date(sunday.getTime() + SUMMARY_AT_MS);
      if (at >= range.from && at < range.to)
        items.push({
          at: at.toISOString(),
          title: 'Weekly summary',
          confirmed: true,
          href: '/wellbeing',
        });
    }
    return items;
  };
  const { router, openapi } = routes(platform, service);
  platform.schedule(JOB_NAME, JOB_EVERY_MS, (now) => runOnce(platform, now));
  return {
    id: 'wellbeing',
    label: 'Wellbeing',
    order: 30,
    roles: ['student', 'mentor'],
    router,
    dashboardSummary: (user) => service.dashboard(user.id, new Date()),
    weekItems: (user, range) => weekItems(user, range),
    publicApi,
    seed: () => seedWellbeing(platform),
    openapi,
  };
};

export default wellbeing;
