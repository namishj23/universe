import { Router } from 'express';
import type { ModuleFactory } from '../../platform/modules/index.js';

// Module A · Student Hub (Person 1). Routes arrive in P4.
const hub: ModuleFactory = () => ({
  id: 'hub',
  label: 'Student Hub',
  order: 10,
  roles: ['student', 'mentor', 'admin'],
  router: Router(),
  dashboardSummary: () => Promise.resolve({ status: 'not_built' }),
  filePurposes: [
    {
      id: 'hub.resource',
      mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      maxBytes: 10 * 1024 * 1024,
      // Owner or admin until P4 adds the shared resource repository's own visibility rules.
      authorizeRead: (user, file) => user.id === file.ownerId || user.role === 'admin',
    },
  ],
});

export default hub;
