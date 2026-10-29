// Each owner area adds its own seed file and one call below.
import { prisma } from '../../apps/api/src/platform/db.js';
import { seedPlatform } from './platform.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is production.');
  process.exit(1);
}
const password = process.env.SEED_DEMO_PASSWORD ?? '';
if (password.length < 12) {
  console.error('SEED_DEMO_PASSWORD must be set to at least 12 characters (apps/api/.env).');
  process.exit(1);
}

try {
  await seedPlatform(prisma, password);
  console.log('Seed complete.');
} finally {
  await prisma.$disconnect();
}
