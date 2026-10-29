import { Router } from 'express';
import type { ModuleFactory } from '../../platform/modules/index.js';

// Module D · Digital Wellbeing (Person 1). Personal data, so admins do not see it. Routes arrive in P5.
const wellbeing: ModuleFactory = () => ({
  id: 'wellbeing',
  label: 'Wellbeing',
  order: 30,
  roles: ['student', 'mentor'],
  router: Router(),
  dashboardSummary: () => Promise.resolve({ status: 'not_built' }),
});

export default wellbeing;
