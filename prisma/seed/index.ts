// Each owner area adds its own seed: Platform here, modules through `seed()` in their ModuleDefinition.
import { prisma } from '../../apps/api/src/platform/db.js';
import { loadModules } from '../../apps/api/src/platform/modules/index.js';
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
  for (const module of await loadModules()) {
    if (!module.seed) continue;
    await module.seed();
    console.log(`Seeded ${module.id}.`);
  }
  console.log('Seed complete.');
} finally {
  await prisma.$disconnect();
}
