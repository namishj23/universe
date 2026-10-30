// Module D · Privacy-Aware Digital Wellbeing (Person 1). Personal data: only the owner sees it
// (students and mentors; admins never). Raw browsing data stays in the browser
// (`@universe/wellbeing-core`); the server keeps daily category totals and settings only.
import type { ModuleFactory } from '../../platform/modules/index.js';
import { JOB_EVERY_MS, JOB_NAME, runOnce } from './jobs.js';
import { routes } from './routes.js';
import { seedWellbeing } from './seed.js';
import { wellbeingService } from './service.js';

const wellbeing: ModuleFactory = (platform) => {
  const service = wellbeingService(platform);
  const { router, openapi } = routes(platform, service);
  platform.schedule(JOB_NAME, JOB_EVERY_MS, (now) => runOnce(platform, now));
  return {
    id: 'wellbeing',
    label: 'Wellbeing',
    order: 30,
    roles: ['student', 'mentor'],
    router,
    dashboardSummary: (user) => service.dashboard(user.id, new Date()),
    seed: () => seedWellbeing(platform),
    openapi,
  };
};

export default wellbeing;
