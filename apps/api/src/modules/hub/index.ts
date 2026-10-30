// Module A · Student Intelligence and Academic Hub (Person 1): profiles and placement goals,
// prep tracking, mentor ranking and mentorship requests, and the shared resource repository.
// Reaches the platform only through `platform`.
import type { Role } from '@universe/contracts';
import type { ModuleFactory } from '../../platform/modules/index.js';
import { dashboardService } from './dashboard.js';
import { mentorService } from './mentors.js';
import { prepService } from './prep.js';
import { profileService } from './profiles.js';
import { requestService } from './requests.js';
import { resourceService } from './resources.js';
import { routes } from './routes.js';
import { seedHub } from './seed.js';

const ROLES: readonly Role[] = ['student', 'mentor', 'admin'];

const hub: ModuleFactory = (platform) => {
  const prep = prepService(platform);
  const mentors = mentorService(platform, prep);
  const services = {
    prep,
    mentors,
    profiles: profileService(platform, prep),
    requests: requestService(platform, prep),
    resources: resourceService(platform),
    dashboard: dashboardService(platform, prep, mentors),
  };
  const { router, openapi } = routes(platform, services);
  const resourceRefs = (fileIds: readonly string[], liveOnly: boolean) =>
    platform.prisma.hubResource.findMany({
      where: { fileId: { in: [...fileIds] }, ...(liveOnly && { deletedAt: null }) },
      select: { fileId: true },
    });

  return {
    id: 'hub',
    label: 'Student Hub',
    order: 10,
    roles: ROLES,
    router,
    dashboardSummary: (user) => services.dashboard(user),
    seed: () => seedHub(platform),
    filePurposes: [
      {
        id: 'hub.resource',
        mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
        maxBytes: 10 * 1024 * 1024,
        // GET /api/files/:id is a platform route: drivers and invigilators are kept out here.
        // Hub users read files attached to a live resource; unattached files stay owner-only.
        authorizeRead: async (user, file) =>
          ROLES.includes(user.role) &&
          (user.role === 'admin' ||
            user.id === file.ownerId ||
            (await resourceRefs([file.id], true)).length > 0),
        // Attached to any resource row (deleted ones too, for the admin view): never deleted or swept.
        inUse: async (ids) => new Set((await resourceRefs(ids, false)).map((r) => r.fileId)),
      },
    ],
    openapi,
  };
};

export default hub;
