import { Router } from 'express';
import type { ModuleDefinition } from '../../platform/modules/index.js';

// Module A · Student Hub (Person 1). Routes arrive in P4.
const roles = ['student', 'mentor', 'admin'] as const;

const hub: ModuleDefinition = {
  id: 'hub',
  label: 'Student Hub',
  order: 10,
  roles,
  router: Router(),
  dashboardSummary: () => Promise.resolve({ status: 'not_built' }),
  filePurposes: [
    {
      id: 'hub.resource',
      mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      maxBytes: 10 * 1024 * 1024,
      // The resource repository is shared with everyone who may use the hub; P4 refines this.
      authorizeRead: (user) => (roles as readonly string[]).includes(user.role),
    },
  ],
};

export default hub;
